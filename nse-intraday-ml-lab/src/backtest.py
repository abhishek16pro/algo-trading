"""Event-driven, bar-by-bar backtester.

Execution model
---------------
* Signals are computed at the **close** of bar ``t`` using features known at
  ``t`` and the model trained on data strictly before the test window.
* Orders generated at bar ``t`` are filled at the **open** of bar ``t+1``. This
  is the simplest defense against look-ahead bias.
* Stop-loss / take-profit are checked against bar ``t+1``'s ``high`` and
  ``low``. If both are touched in the same bar we take the conservative (loss)
  outcome.

This is paper trading only — there is no broker API and no live order routing.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .strategy import (
    Action,
    CostConfig,
    PositionState,
    RiskConfig,
    StrategyConfig,
    decide_action,
    position_size,
)

logger = logging.getLogger(__name__)


@dataclass
class Trade:
    symbol: str
    entry_time: pd.Timestamp
    exit_time: pd.Timestamp
    entry_price: float
    exit_price: float
    qty: int
    gross_pnl: float
    costs: float
    net_pnl: float
    reason: str  # "tp" | "sl" | "time" | "signal"
    bars_held: int

    def as_dict(self) -> dict:
        d = self.__dict__.copy()
        d["entry_time"] = str(self.entry_time)
        d["exit_time"] = str(self.exit_time)
        return d


@dataclass
class BacktestResult:
    trades: pd.DataFrame
    equity_curve: pd.DataFrame  # columns: timestamp, equity
    summary: dict
    daily_returns: pd.Series = field(default_factory=lambda: pd.Series(dtype=float))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _round_trip_cost(price: float, qty: int, costs: CostConfig) -> float:
    """Cost of a *single* leg (entry or exit)."""
    notional = price * qty
    return (
        costs.commission_per_trade
        + notional * (costs.spread_bps / 10_000.0) / 2.0  # half-spread per leg
        + notional * (costs.slippage_bps / 10_000.0)
    )


def _apply_fill_slippage(price: float, side: str, costs: CostConfig) -> float:
    """Push the fill against us by half the spread + slippage."""
    bump = (costs.spread_bps / 2.0 + costs.slippage_bps) / 10_000.0
    if side == "buy":
        return price * (1.0 + bump)
    return price * (1.0 - bump)


# ---------------------------------------------------------------------------
# Core loop
# ---------------------------------------------------------------------------

def run_backtest(
    df: pd.DataFrame,
    p_up: pd.Series,
    *,
    strategy: StrategyConfig,
    risk: RiskConfig,
    costs: CostConfig,
    atr_col: str = "atr",
) -> BacktestResult:
    """Run a long-only event-driven backtest.

    Parameters
    ----------
    df : DataFrame containing at least ``timestamp, symbol, open, high, low,
        close`` and the ATR column, restricted to the test window of one fold.
    p_up : aligned Series of P(up) for each row in ``df``.
    """
    if len(df) == 0:
        return BacktestResult(
            trades=pd.DataFrame(),
            equity_curve=pd.DataFrame(columns=["timestamp", "equity"]),
            summary={"trades": 0, "final_equity": risk.starting_equity},
        )

    # Sort df and p_up jointly, then drop both indices positionally. We can't
    # rely on label-based reindex here: callers often pass slices whose index
    # labels don't start at 0, and the reset would silently NaN-fill.
    order = df.sort_values(["timestamp", "symbol"]).index
    df = df.loc[order].reset_index(drop=True)
    p_up = pd.Series(p_up.loc[order].to_numpy(), index=df.index)

    equity = risk.starting_equity
    open_positions: dict[str, PositionState] = {}
    trades: list[Trade] = []

    # Equity is sampled per timestamp (end of bar), so we can plot a curve.
    unique_ts = df["timestamp"].drop_duplicates().sort_values().to_list()
    equity_curve: list[tuple[pd.Timestamp, float]] = []

    # Daily PnL tracking for the circuit-breaker.
    day_start_equity = equity
    current_day: pd.Timestamp | None = None
    daily_pnl: dict[pd.Timestamp, float] = {}

    # Build a per-(symbol) ordered view for fast next-bar access.
    by_symbol: dict[str, pd.DataFrame] = {
        sym: g.reset_index(drop=True) for sym, g in df.groupby("symbol", sort=False)
    }
    # Map (sym, timestamp) -> row index inside by_symbol[sym].
    sym_ts_idx: dict[tuple[str, pd.Timestamp], int] = {}
    for sym, g in by_symbol.items():
        for i, ts in enumerate(g["timestamp"]):
            sym_ts_idx[(sym, ts)] = i

    # We process bars in chronological order across symbols.
    df_indexed = df.assign(_p=p_up.values)
    for ts in unique_ts:
        day = ts.normalize()
        if current_day is None or day != current_day:
            current_day = day
            day_start_equity = equity

        breaker_tripped = (
            equity <= day_start_equity * (1.0 - risk.max_daily_loss_pct)
        )

        rows = df_indexed[df_indexed["timestamp"] == ts]
        for _, row in rows.iterrows():
            sym = row["symbol"]
            g = by_symbol[sym]
            i = sym_ts_idx[(sym, ts)]
            has_next = i + 1 < len(g)
            next_row = g.iloc[i + 1] if has_next else None

            pos = open_positions.get(sym)
            in_position = pos is not None
            bars_held = pos.bars_held if pos else 0
            p = float(row["_p"]) if not np.isnan(row["_p"]) else 0.0

            # --- 1) Exit logic on intrabar of NEXT bar (SL/TP) -----------------
            if pos is not None and next_row is not None:
                hi = float(next_row["high"])
                lo = float(next_row["low"])
                exit_reason: str | None = None
                exit_price: float | None = None
                # Worst-case tie-break: if both barriers touched in same bar -> SL.
                if lo <= pos.stop_loss and hi >= pos.take_profit:
                    exit_price = pos.stop_loss
                    exit_reason = "sl"
                elif lo <= pos.stop_loss:
                    exit_price = pos.stop_loss
                    exit_reason = "sl"
                elif hi >= pos.take_profit:
                    exit_price = pos.take_profit
                    exit_reason = "tp"

                if exit_reason is not None and exit_price is not None:
                    fill = _apply_fill_slippage(exit_price, side="sell", costs=costs)
                    gross = (fill - pos.entry_price) * pos.qty
                    exit_leg_cost = _round_trip_cost(fill, pos.qty, costs)
                    total_costs = pos.entry_leg_cost + exit_leg_cost
                    # equity was already debited entry_leg_cost at entry time;
                    # here we only need to apply (gross - exit_leg_cost).
                    equity += gross - exit_leg_cost
                    trades.append(
                        Trade(
                            symbol=sym,
                            entry_time=g.iloc[pos.entry_bar_idx]["timestamp"],
                            exit_time=next_row["timestamp"],
                            entry_price=pos.entry_price,
                            exit_price=fill,
                            qty=pos.qty,
                            gross_pnl=gross,
                            costs=total_costs,
                            net_pnl=gross - total_costs,
                            reason=exit_reason,
                            bars_held=pos.bars_held + 1,
                        )
                    )
                    del open_positions[sym]
                    pos = None
                    in_position = False

            # --- 2) Strategy-driven decision (signal/time exit, new entry) -----
            action = decide_action(
                in_position=in_position, p_up=p, bars_held=bars_held, cfg=strategy
            )

            if action == Action.EXIT and pos is not None and next_row is not None:
                fill = _apply_fill_slippage(float(next_row["open"]), side="sell", costs=costs)
                gross = (fill - pos.entry_price) * pos.qty
                exit_leg_cost = _round_trip_cost(fill, pos.qty, costs)
                total_costs = pos.entry_leg_cost + exit_leg_cost
                equity += gross - exit_leg_cost
                reason = "time" if pos.bars_held + 1 >= strategy.time_exit_bars else "signal"
                trades.append(
                    Trade(
                        symbol=sym,
                        entry_time=g.iloc[pos.entry_bar_idx]["timestamp"],
                        exit_time=next_row["timestamp"],
                        entry_price=pos.entry_price,
                        exit_price=fill,
                        qty=pos.qty,
                        gross_pnl=gross,
                        costs=total_costs,
                        net_pnl=gross - total_costs,
                        reason=reason,
                        bars_held=pos.bars_held + 1,
                    )
                )
                del open_positions[sym]
                pos = None
                in_position = False

            elif (
                action == Action.ENTER_LONG
                and not in_position
                and next_row is not None
                and not breaker_tripped
                and len(open_positions) < risk.max_concurrent_positions
                and sum(1 for p_ in open_positions.values() if p_.symbol == sym)
                < risk.max_positions_per_symbol
            ):
                atr_val = float(row[atr_col]) if atr_col in row else float("nan")
                if not np.isfinite(atr_val) or atr_val <= 0:
                    pass
                else:
                    raw_open = float(next_row["open"])
                    fill = _apply_fill_slippage(raw_open, side="buy", costs=costs)
                    qty = position_size(
                        equity=equity,
                        entry_price=fill,
                        atr=atr_val,
                        cfg=strategy,
                        risk=risk,
                    )
                    if qty > 0:
                        leg_cost = _round_trip_cost(fill, qty, costs)
                        equity -= leg_cost  # entry-side cost paid now
                        open_positions[sym] = PositionState(
                            symbol=sym,
                            entry_bar_idx=i + 1,  # we entered on next bar
                            entry_price=fill,
                            qty=qty,
                            stop_loss=fill - strategy.stop_loss_atr * atr_val,
                            take_profit=fill + strategy.take_profit_atr * atr_val,
                            bars_held=0,
                            entry_leg_cost=leg_cost,
                        )

            # Increment bars_held for any still-open position on this symbol.
            if sym in open_positions:
                open_positions[sym].bars_held += 1

        # Mark-to-market equity at this timestamp (use close prices for open positions).
        mtm = equity
        for sym, pos in open_positions.items():
            close_price = float(rows.loc[rows["symbol"] == sym, "close"].iloc[0]) if (
                (rows["symbol"] == sym).any()
            ) else pos.entry_price
            mtm += (close_price - pos.entry_price) * pos.qty
        equity_curve.append((ts, mtm))
        daily_pnl[day] = mtm - day_start_equity

    # Force-close anything still open at the very last bar (avoid lingering positions).
    if open_positions:
        last_ts = unique_ts[-1]
        for sym, pos in list(open_positions.items()):
            g = by_symbol[sym]
            i = sym_ts_idx[(sym, last_ts)]
            last_close = float(g.iloc[i]["close"])
            fill = _apply_fill_slippage(last_close, side="sell", costs=costs)
            gross = (fill - pos.entry_price) * pos.qty
            exit_leg_cost = _round_trip_cost(fill, pos.qty, costs)
            total_costs = pos.entry_leg_cost + exit_leg_cost
            equity += gross - exit_leg_cost
            trades.append(
                Trade(
                    symbol=sym,
                    entry_time=g.iloc[pos.entry_bar_idx]["timestamp"],
                    exit_time=last_ts,
                    entry_price=pos.entry_price,
                    exit_price=fill,
                    qty=pos.qty,
                    gross_pnl=gross,
                    costs=total_costs,
                    net_pnl=gross - total_costs,
                    reason="eod_force",
                    bars_held=pos.bars_held,
                )
            )
            del open_positions[sym]

    # --- Build outputs ----------------------------------------------------------
    trades_df = pd.DataFrame([t.as_dict() for t in trades])
    eq_df = pd.DataFrame(equity_curve, columns=["timestamp", "equity"])

    summary = _summarize(trades_df, eq_df, risk.starting_equity)
    daily_returns = (
        eq_df.assign(day=eq_df["timestamp"].dt.normalize())
        .groupby("day")["equity"]
        .last()
        .pct_change()
        .dropna()
    )
    return BacktestResult(trades_df, eq_df, summary, daily_returns)


# ---------------------------------------------------------------------------
# Performance summary
# ---------------------------------------------------------------------------

def _summarize(trades: pd.DataFrame, equity_curve: pd.DataFrame, starting_equity: float) -> dict:
    if equity_curve.empty:
        return {"trades": 0, "final_equity": starting_equity}
    eq = equity_curve["equity"].values
    final_equity = float(eq[-1])
    total_return = final_equity / starting_equity - 1.0

    # Drawdown.
    peak = np.maximum.accumulate(eq)
    dd = (eq - peak) / peak
    max_dd = float(dd.min()) if len(dd) else 0.0

    # Daily returns for Sharpe (annualized assuming ~252 trading days).
    daily = (
        equity_curve.assign(day=equity_curve["timestamp"].dt.normalize())
        .groupby("day")["equity"]
        .last()
        .pct_change()
        .dropna()
    )
    if len(daily) > 1 and daily.std(ddof=1) > 0:
        sharpe = float(np.sqrt(252) * daily.mean() / daily.std(ddof=1))
    else:
        sharpe = 0.0

    n = int(len(trades))
    win_rate = float((trades["net_pnl"] > 0).mean()) if n else 0.0
    avg_trade = float(trades["net_pnl"].mean()) if n else 0.0
    gross_profit = float(trades.loc[trades["net_pnl"] > 0, "net_pnl"].sum()) if n else 0.0
    gross_loss = float(-trades.loc[trades["net_pnl"] < 0, "net_pnl"].sum()) if n else 0.0
    profit_factor = float(gross_profit / gross_loss) if gross_loss > 0 else float("inf") if gross_profit > 0 else 0.0
    turnover = (
        float(trades["entry_price"].mul(trades["qty"]).sum()) if n else 0.0
    )

    return {
        "trades": n,
        "final_equity": final_equity,
        "total_return": total_return,
        "sharpe_daily_ann": sharpe,
        "max_drawdown": max_dd,
        "win_rate": win_rate,
        "avg_trade_pnl": avg_trade,
        "profit_factor": profit_factor,
        "turnover_inr": turnover,
    }

"""Translate model probabilities into trading actions.

The strategy is intentionally simple and long-only. It is the *backtest's* job
(``backtest.py``) to schedule the actual fills on the next bar and apply costs;
this module just decides *what to do at the close of bar t*.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class Action(str, Enum):
    HOLD = "HOLD"
    ENTER_LONG = "ENTER_LONG"
    EXIT = "EXIT"


@dataclass
class StrategyConfig:
    entry_threshold: float = 0.58
    exit_threshold: float = 0.48
    time_exit_bars: int = 12
    take_profit_atr: float = 1.5
    stop_loss_atr: float = 1.0


@dataclass
class RiskConfig:
    starting_equity: float = 1_000_000.0
    risk_per_trade: float = 0.005
    max_positions_per_symbol: int = 1
    max_concurrent_positions: int = 5
    max_daily_loss_pct: float = 0.02


@dataclass
class CostConfig:
    commission_per_trade: float = 20.0
    spread_bps: float = 3.0
    slippage_bps: float = 3.0


@dataclass
class PositionState:
    """In-memory state of a single open long position."""
    symbol: str
    entry_bar_idx: int
    entry_price: float
    qty: int
    stop_loss: float
    take_profit: float
    bars_held: int = 0
    entry_leg_cost: float = 0.0   # commission + spread + slippage on the entry leg


def decide_action(
    *,
    in_position: bool,
    p_up: float,
    bars_held: int,
    cfg: StrategyConfig,
) -> Action:
    """Decide the action at bar t given the current state.

    Note: stop-loss / take-profit / circuit-breaker logic is enforced in the
    backtest loop using the *next* bar's high/low — they don't depend on the
    model probability at all.
    """
    if not in_position:
        if p_up >= cfg.entry_threshold:
            return Action.ENTER_LONG
        return Action.HOLD

    # Already in position.
    if bars_held >= cfg.time_exit_bars:
        return Action.EXIT
    if p_up < cfg.exit_threshold:
        return Action.EXIT
    return Action.HOLD


def position_size(
    *,
    equity: float,
    entry_price: float,
    atr: float,
    cfg: StrategyConfig,
    risk: RiskConfig,
) -> int:
    """Fixed-fractional risk sizing.

    Risk per trade = equity * risk_per_trade.
    Per-share risk  = stop_loss_atr * atr.
    Qty             = floor(risk / per_share_risk), clipped at 0.
    """
    if atr <= 0 or entry_price <= 0:
        return 0
    risk_amount = equity * risk.risk_per_trade
    per_share_risk = cfg.stop_loss_atr * atr
    if per_share_risk <= 0:
        return 0
    qty = int(risk_amount // per_share_risk)
    # cap by available capital (notional <= equity)
    cap_by_notional = int(equity // entry_price)
    return max(0, min(qty, cap_by_notional))

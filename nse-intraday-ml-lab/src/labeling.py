"""Labeling strategies for intraday ML.

Two label generators are provided:

* :func:`direction_labels` — y=1 if forward return over ``horizon`` bars > 0.
* :func:`barrier_labels` — triple-barrier-style: y=1 if a take-profit barrier
  is hit before a stop-loss barrier within ``horizon`` bars, else y=0.

Both functions guarantee that labels at bar t use **only** prices from bars
``t+1 ... t+horizon``. The label row itself is dropped if any of its lookahead
window extends past the symbol's last bar.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd


@dataclass
class LabelingConfig:
    method: str = "barrier"      # "direction" or "barrier"
    horizon: int = 12
    take_profit_atr: float = 1.5
    stop_loss_atr: float = 1.0
    # The ATR column name to use for barrier widths (must already exist on df).
    atr_col: str = "atr"


def _per_symbol_direction(g: pd.DataFrame, horizon: int) -> pd.Series:
    fwd_close = g["close"].shift(-horizon)
    fwd_ret = np.log(fwd_close) - np.log(g["close"])
    y = (fwd_ret > 0).astype("Int8")
    # rows whose forward window extends past the last bar -> invalid label
    y[fwd_close.isna()] = pd.NA
    return y


def direction_labels(df: pd.DataFrame, cfg: LabelingConfig) -> pd.Series:
    """y=1 if log(close[t+H] / close[t]) > 0 else 0. NaN at the tail."""
    parts = []
    for _, g in df.groupby("symbol", sort=False):
        parts.append(_per_symbol_direction(g, cfg.horizon))
    return pd.concat(parts).reindex(df.index)


def _per_symbol_barrier(g: pd.DataFrame, cfg: LabelingConfig) -> pd.Series:
    """For each bar t, walk forward up to ``horizon`` bars and check which
    barrier is touched first using subsequent bars' high/low.

    To avoid look-ahead, the barriers are computed from the close at t and the
    ATR known at t, and we evaluate them against highs/lows of bars t+1..t+H.
    """
    close = g["close"].to_numpy()
    high = g["high"].to_numpy()
    low = g["low"].to_numpy()
    atr = g[cfg.atr_col].to_numpy()
    n = len(g)
    y = np.full(n, fill_value=np.nan, dtype=float)

    H = cfg.horizon
    tp_k = cfg.take_profit_atr
    sl_k = cfg.stop_loss_atr

    for i in range(n - H):
        a = atr[i]
        if not np.isfinite(a) or a <= 0:
            continue
        entry = close[i]
        tp = entry + tp_k * a
        sl = entry - sl_k * a
        label = 0  # neither barrier hit within horizon -> 0
        for j in range(i + 1, i + 1 + H):
            hit_tp = high[j] >= tp
            hit_sl = low[j] <= sl
            if hit_tp and hit_sl:
                # Conservative tie-break: assume worst case for the long side.
                # i.e., stop-loss touched first if both look possible in one bar.
                label = 0
                break
            if hit_tp:
                label = 1
                break
            if hit_sl:
                label = 0
                break
        y[i] = label
    return pd.Series(y, index=g.index, dtype="Float64")


def barrier_labels(df: pd.DataFrame, cfg: LabelingConfig) -> pd.Series:
    if cfg.atr_col not in df.columns:
        raise ValueError(
            f"barrier labeling requires column {cfg.atr_col!r} (build features first)."
        )
    parts = []
    for _, g in df.groupby("symbol", sort=False):
        parts.append(_per_symbol_barrier(g, cfg))
    return pd.concat(parts).reindex(df.index)


def make_labels(df: pd.DataFrame, cfg: LabelingConfig) -> pd.Series:
    """Dispatch to the configured labeling method."""
    if cfg.method == "direction":
        return direction_labels(df, cfg)
    if cfg.method == "barrier":
        return barrier_labels(df, cfg)
    raise ValueError(f"Unknown labeling method: {cfg.method!r}")

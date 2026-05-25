"""Feature engineering for intraday bars.

Every feature here must be computable using only information available *at the
close of the bar it is attached to*. Anything else is look-ahead bias and will
make backtests lie. The :func:`assert_no_leakage` helper at the bottom of the
module is your friend — call it after building features.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Sequence

import numpy as np
import pandas as pd


@dataclass
class FeatureConfig:
    return_lags: Sequence[int] = (1, 5, 15)
    vol_window: int = 20
    atr_window: int = 14
    rsi_window: int = 14
    macd_fast: int = 12
    macd_slow: int = 26
    macd_signal: int = 9
    ma_windows: Sequence[int] = (10, 20, 50)
    volume_z_window: int = 50
    timeframe: str = "5min"

    # Populated after feature construction; consumed by the modeling step.
    feature_columns_: list[str] = field(default_factory=list, repr=False)


# ---------------------------------------------------------------------------
# Indicator primitives — pure functions of past data.
# ---------------------------------------------------------------------------

def _rsi(close: pd.Series, window: int) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0.0)
    loss = -delta.clip(upper=0.0)
    avg_gain = gain.ewm(alpha=1.0 / window, adjust=False, min_periods=window).mean()
    avg_loss = loss.ewm(alpha=1.0 / window, adjust=False, min_periods=window).mean()
    rs = avg_gain / avg_loss.replace(0.0, np.nan)
    return 100.0 - 100.0 / (1.0 + rs)


def _atr(high: pd.Series, low: pd.Series, close: pd.Series, window: int) -> pd.Series:
    prev_close = close.shift(1)
    tr = pd.concat(
        [
            (high - low).abs(),
            (high - prev_close).abs(),
            (low - prev_close).abs(),
        ],
        axis=1,
    ).max(axis=1)
    return tr.ewm(alpha=1.0 / window, adjust=False, min_periods=window).mean()


def _macd(
    close: pd.Series, fast: int, slow: int, signal: int
) -> tuple[pd.Series, pd.Series, pd.Series]:
    ema_fast = close.ewm(span=fast, adjust=False, min_periods=fast).mean()
    ema_slow = close.ewm(span=slow, adjust=False, min_periods=slow).mean()
    macd = ema_fast - ema_slow
    sig = macd.ewm(span=signal, adjust=False, min_periods=signal).mean()
    hist = macd - sig
    return macd, sig, hist


# ---------------------------------------------------------------------------
# Per-symbol feature construction.
# ---------------------------------------------------------------------------

def _features_for_symbol(g: pd.DataFrame, cfg: FeatureConfig) -> pd.DataFrame:
    out = g.copy()
    close = out["close"]
    high = out["high"]
    low = out["low"]
    vol = out["volume"].astype(float)

    log_close = np.log(close.replace(0.0, np.nan))

    # Log returns at multiple horizons (computed from PAST closes only).
    for k in cfg.return_lags:
        out[f"logret_{k}"] = log_close.diff(k)

    # Realized volatility on 1-bar log returns.
    r1 = log_close.diff(1)
    out["rvol"] = r1.rolling(cfg.vol_window, min_periods=cfg.vol_window).std()

    # ATR — used both as a feature and for barrier labeling / risk sizing.
    out["atr"] = _atr(high, low, close, cfg.atr_window)
    out["atr_pct"] = out["atr"] / close

    # RSI.
    out["rsi"] = _rsi(close, cfg.rsi_window)

    # MACD.
    macd, sig, hist = _macd(close, cfg.macd_fast, cfg.macd_slow, cfg.macd_signal)
    out["macd"] = macd
    out["macd_signal"] = sig
    out["macd_hist"] = hist

    # Distance from moving averages (in % of price).
    for w in cfg.ma_windows:
        ma = close.rolling(w, min_periods=w).mean()
        out[f"ma_{w}_dist"] = (close - ma) / ma

    # Volume z-score.
    vmean = vol.rolling(cfg.volume_z_window, min_periods=cfg.volume_z_window).mean()
    vstd = vol.rolling(cfg.volume_z_window, min_periods=cfg.volume_z_window).std()
    out["volume_z"] = (vol - vmean) / vstd.replace(0.0, np.nan)

    # Time-of-day encoding.
    minute_of_day = out["timestamp"].dt.hour * 60 + out["timestamp"].dt.minute
    # NSE regular session is 09:15 (= 555 min) → 15:30 (= 930 min) = 375 minutes.
    period = 24 * 60  # use full day to be robust to non-NSE sessions / pre-post bars
    out["tod_sin"] = np.sin(2 * np.pi * minute_of_day / period)
    out["tod_cos"] = np.cos(2 * np.pi * minute_of_day / period)

    return out


def create_features(df: pd.DataFrame, cfg: FeatureConfig) -> pd.DataFrame:
    """Build features for every symbol.

    The input must come from :func:`data_loader.load_csv` — sorted by
    (symbol, timestamp). Rows with insufficient history (NaNs from rolling
    windows) are dropped *per symbol* at the end.

    Side effect: ``cfg.feature_columns_`` is populated with the column names
    that downstream code should use as ``X``.
    """
    pieces: list[pd.DataFrame] = []
    for _, g in df.groupby("symbol", sort=False):
        pieces.append(_features_for_symbol(g, cfg))
    out = pd.concat(pieces, ignore_index=True)

    feature_cols = [
        c
        for c in out.columns
        if c not in ("timestamp", "symbol", "open", "high", "low", "close", "volume")
    ]
    cfg.feature_columns_ = feature_cols

    # Drop rows where any required feature is NaN. Done per-symbol implicitly
    # because warm-up bars are at the start of each symbol's series.
    out = out.dropna(subset=feature_cols).reset_index(drop=True)
    return out


# ---------------------------------------------------------------------------
# Leakage guardrail.
# ---------------------------------------------------------------------------

def assert_no_leakage(features_df: pd.DataFrame, raw_df: pd.DataFrame) -> None:
    """Sanity-check that every feature row's timestamp is present in the raw data.

    This catches the most embarrassing mistakes (e.g., joining on a future
    timestamp). It does NOT prove the absence of look-ahead — for that you must
    inspect each feature's formula. But if this assertion fires, something is
    deeply wrong.
    """
    raw_index = raw_df.set_index(["symbol", "timestamp"]).index
    feat_index = features_df.set_index(["symbol", "timestamp"]).index
    missing = feat_index.difference(raw_index)
    if len(missing) > 0:
        raise AssertionError(
            f"Leakage check failed: {len(missing)} feature rows have "
            f"(symbol, timestamp) pairs not in the raw input. "
            f"First offenders: {list(missing[:5])}"
        )

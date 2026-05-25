"""Load and validate intraday OHLCV CSV data.

The loader is intentionally strict: bad data here corrupts everything downstream.
It does *not* fabricate missing bars — that is a modeling choice you should make
explicitly, not an accident of the loader.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import pandas as pd

logger = logging.getLogger(__name__)

REQUIRED_COLUMNS = ["timestamp", "symbol", "open", "high", "low", "close", "volume"]

_TIMEFRAME_TO_MINUTES = {"1min": 1, "5min": 5, "15min": 15}


@dataclass
class LoaderReport:
    """Summary of what the loader did to your data."""

    rows_in: int
    rows_out: int
    duplicates_dropped: int
    symbols: list[str]
    timestamp_min: pd.Timestamp
    timestamp_max: pd.Timestamp
    irregular_gaps: dict[str, int]

    def as_dict(self) -> dict:
        return {
            "rows_in": self.rows_in,
            "rows_out": self.rows_out,
            "duplicates_dropped": self.duplicates_dropped,
            "symbols": self.symbols,
            "timestamp_min": str(self.timestamp_min),
            "timestamp_max": str(self.timestamp_max),
            "irregular_gaps": self.irregular_gaps,
        }


def _validate_schema(df: pd.DataFrame) -> None:
    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(
            f"CSV is missing required columns: {missing}. "
            f"Expected schema: {REQUIRED_COLUMNS}"
        )


def _coerce_types(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["timestamp"] = pd.to_datetime(df["timestamp"], errors="raise", utc=False)
    df["symbol"] = df["symbol"].astype(str).str.strip().str.upper()
    for col in ["open", "high", "low", "close", "volume"]:
        df[col] = pd.to_numeric(df[col], errors="raise")
    return df


def _sanity_checks(df: pd.DataFrame) -> None:
    bad = df[(df["high"] < df["low"]) | (df["open"] <= 0) | (df["close"] <= 0)]
    if not bad.empty:
        raise ValueError(
            f"Found {len(bad)} rows with impossible OHLC values "
            f"(high<low or non-positive prices). First offender:\n{bad.head(1)}"
        )
    if (df["volume"] < 0).any():
        raise ValueError("Negative volume rows present — clean your data.")


def _filter_session(
    df: pd.DataFrame, session_start: str | None, session_end: str | None
) -> pd.DataFrame:
    if not session_start or not session_end:
        return df
    t = df["timestamp"].dt.time
    start = pd.to_datetime(session_start).time()
    end = pd.to_datetime(session_end).time()
    mask = (t >= start) & (t <= end)
    dropped = (~mask).sum()
    if dropped:
        logger.info("Dropped %d rows outside session %s-%s", dropped, session_start, session_end)
    return df.loc[mask].copy()


def _filter_symbols(df: pd.DataFrame, symbols: Iterable[str] | None) -> pd.DataFrame:
    if not symbols:
        return df
    wanted = {s.upper() for s in symbols}
    out = df[df["symbol"].isin(wanted)].copy()
    if out.empty:
        raise ValueError(
            f"No rows left after filtering for symbols={sorted(wanted)}. "
            f"Available symbols: {sorted(df['symbol'].unique())[:20]}"
        )
    return out


def _check_bar_spacing(df: pd.DataFrame, timeframe: str) -> dict[str, int]:
    """Count irregular bar gaps per symbol (does not fix them)."""
    if timeframe not in _TIMEFRAME_TO_MINUTES:
        logger.warning("Unknown timeframe %r — skipping spacing check.", timeframe)
        return {}
    expected = pd.Timedelta(minutes=_TIMEFRAME_TO_MINUTES[timeframe])
    gaps: dict[str, int] = {}
    for sym, sub in df.groupby("symbol"):
        diffs = sub["timestamp"].diff().dropna()
        # Allow same-day session breaks; only flag intraday irregularities.
        same_day = sub["timestamp"].dt.normalize().diff().dropna() == pd.Timedelta(0)
        intraday_diffs = diffs[same_day.values]
        odd = (intraday_diffs != expected).sum()
        if odd:
            gaps[sym] = int(odd)
    if gaps:
        logger.warning(
            "Irregular bar spacing detected (timeframe=%s). Counts per symbol: %s",
            timeframe,
            gaps,
        )
    return gaps


def load_csv(
    path: str | Path,
    *,
    symbols: Iterable[str] | None = None,
    timeframe: str = "5min",
    session_start: str | None = None,
    session_end: str | None = None,
) -> tuple[pd.DataFrame, LoaderReport]:
    """Load an intraday OHLCV CSV, validate, and return a clean DataFrame.

    Parameters
    ----------
    path : path to the CSV file. Must include columns
        timestamp, symbol, open, high, low, close, volume.
    symbols : optional iterable to restrict to a subset of symbols.
    timeframe : "1min", "5min", or "15min". Used for spacing diagnostics.
    session_start, session_end : optional ``HH:MM`` strings (IST assumed).
        Rows outside this window are dropped.

    Returns
    -------
    df : sorted, de-duplicated DataFrame.
    report : LoaderReport with diagnostics.
    """
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"CSV not found: {path}")

    df = pd.read_csv(path)
    rows_in = len(df)

    _validate_schema(df)
    df = _coerce_types(df)
    _sanity_checks(df)

    df = _filter_symbols(df, symbols)
    df = _filter_session(df, session_start, session_end)

    before = len(df)
    df = df.drop_duplicates(subset=["timestamp", "symbol"], keep="first")
    duplicates_dropped = before - len(df)
    if duplicates_dropped:
        logger.info("Dropped %d duplicate (timestamp, symbol) rows.", duplicates_dropped)

    df = df.sort_values(["symbol", "timestamp"]).reset_index(drop=True)
    irregular = _check_bar_spacing(df, timeframe)

    report = LoaderReport(
        rows_in=rows_in,
        rows_out=len(df),
        duplicates_dropped=duplicates_dropped,
        symbols=sorted(df["symbol"].unique().tolist()),
        timestamp_min=df["timestamp"].min(),
        timestamp_max=df["timestamp"].max(),
        irregular_gaps=irregular,
    )
    return df, report

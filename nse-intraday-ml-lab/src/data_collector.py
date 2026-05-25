"""Fetch NSE intraday OHLCV bars via Yahoo Finance.

yfinance is the most accessible free source for NSE intraday data. Important
constraints imposed by the upstream API:

- ``1m``                    : last ~7 calendar days only
- ``2m, 5m, 15m, 30m, 90m`` : last ~60 calendar days
- ``60m / 1h``              : last ~730 calendar days

Each Yahoo ticker for an NSE stock has the ``.NS`` suffix (e.g. ``RELIANCE.NS``).
Indices use their own tickers (``^NSEI`` for Nifty 50, ``^NSEBANK`` for Bank
Nifty, ``^CNXIT`` for Nifty IT, ...).

We:
- normalize each ticker to the project schema
  (timestamp, symbol, open, high, low, close, volume),
- convert timestamps to **tz-naive Asia/Kolkata** for downstream consistency,
- optionally restrict to the NSE regular session,
- merge with an existing CSV (dedup on timestamp+symbol).

This module is intentionally tolerant of per-symbol failures: a failed ticker
logs a warning and the rest continue.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Mapping

import pandas as pd

logger = logging.getLogger(__name__)

# Friendly defaults so users don't need to memorize Yahoo's index tickers.
DEFAULT_INDEX_MAP = {
    "NIFTY50":    "^NSEI",
    "BANKNIFTY":  "^NSEBANK",
    "NIFTYIT":    "^CNXIT",
    "NIFTYFIN":   "^CNXFIN",
    "NIFTYMIDCAP": "^NSEMDCP50",
    "INDIAVIX":   "^INDIAVIX",
}


@dataclass
class FetchConfig:
    """Parameters that drive a fetch run.

    Either (period) or (start, end) must be provided. The collector prefers
    explicit start/end when present, otherwise it uses ``period``.
    """
    stocks: list[str] = field(default_factory=list)
    indices: Mapping[str, str] = field(default_factory=dict)
    interval: str = "5m"
    period: str | None = "60d"
    start: str | None = None  # ISO date or None
    end: str | None = None
    output_csv: str = "data/nse_intraday.csv"
    append: bool = True
    filter_session: bool = True
    session_start: str = "09:15"
    session_end: str = "15:30"
    retries: int = 2
    sleep_seconds: float = 0.5     # be polite to Yahoo


# ---------------------------------------------------------------------------
# Symbol normalization
# ---------------------------------------------------------------------------

def _yahoo_ticker_for_stock(sym: str) -> str:
    """Append ``.NS`` if the symbol looks like a bare NSE stock code."""
    s = sym.strip().upper()
    if "." in s or s.startswith("^"):
        return s  # already a Yahoo ticker
    return f"{s}.NS"


def _build_ticker_map(cfg: FetchConfig) -> dict[str, str]:
    """Return {our_symbol -> yahoo_ticker}.

    For stocks ``RELIANCE`` -> ``RELIANCE.NS``.
    For indices the user supplies their own friendly_name -> yahoo_ticker map.
    """
    tickers: dict[str, str] = {}
    for s in cfg.stocks:
        our = s.strip().upper()
        tickers[our] = _yahoo_ticker_for_stock(our)
    for friendly, yticker in cfg.indices.items():
        tickers[friendly.upper()] = yticker
    if not tickers:
        raise ValueError("FetchConfig has no stocks or indices to fetch.")
    return tickers


# ---------------------------------------------------------------------------
# Per-ticker fetch
# ---------------------------------------------------------------------------

def _fetch_one(
    our_symbol: str,
    yahoo_ticker: str,
    *,
    interval: str,
    period: str | None,
    start: str | None,
    end: str | None,
    retries: int,
    sleep_seconds: float,
) -> pd.DataFrame:
    import yfinance as yf  # imported lazily so the rest of the project does not require it

    last_err: Exception | None = None
    for attempt in range(retries + 1):
        try:
            t = yf.Ticker(yahoo_ticker)
            if start and end:
                df = t.history(interval=interval, start=start, end=end, auto_adjust=False)
            else:
                df = t.history(interval=interval, period=period or "60d", auto_adjust=False)
            break
        except Exception as exc:  # network / API errors
            last_err = exc
            logger.warning(
                "Fetch attempt %d for %s failed: %s", attempt + 1, yahoo_ticker, exc
            )
            time.sleep(sleep_seconds * (attempt + 1))
    else:
        logger.error("Giving up on %s after %d attempts: %s",
                     yahoo_ticker, retries + 1, last_err)
        return pd.DataFrame()

    if df is None or df.empty:
        logger.warning("No rows returned for %s (%s).", our_symbol, yahoo_ticker)
        return pd.DataFrame()

    df = df.reset_index()
    # yfinance names the index column 'Datetime' for intraday data.
    ts_col = "Datetime" if "Datetime" in df.columns else "Date"
    df = df.rename(
        columns={
            ts_col: "timestamp",
            "Open": "open",
            "High": "high",
            "Low": "low",
            "Close": "close",
            "Volume": "volume",
        }
    )
    keep = ["timestamp", "open", "high", "low", "close", "volume"]
    df = df[keep].copy()

    # Convert timestamps to Asia/Kolkata, then strip tz so the downstream loader
    # sees naive timestamps (consistent with what the user is likely to export
    # from a broker).
    ts = pd.to_datetime(df["timestamp"], utc=False)
    if getattr(ts.dt, "tz", None) is not None:
        try:
            ts = ts.dt.tz_convert("Asia/Kolkata")
        except (TypeError, AttributeError):
            ts = ts.dt.tz_localize("Asia/Kolkata")
        ts = ts.dt.tz_localize(None)
    df["timestamp"] = ts

    df["symbol"] = our_symbol
    df = df.dropna(subset=["open", "high", "low", "close"])
    df["volume"] = df["volume"].fillna(0).astype("int64")
    return df[["timestamp", "symbol", "open", "high", "low", "close", "volume"]]


# ---------------------------------------------------------------------------
# Top-level driver
# ---------------------------------------------------------------------------

def fetch_data(cfg: FetchConfig) -> pd.DataFrame:
    """Fetch all configured symbols and return one combined DataFrame.

    Per-symbol failures are logged but do not abort the run. The returned
    DataFrame may be smaller than expected if Yahoo rate-limits you.
    """
    tickers = _build_ticker_map(cfg)
    frames: list[pd.DataFrame] = []
    for our, yt in tickers.items():
        logger.info("Fetching %s (%s) interval=%s period=%s ...",
                    our, yt, cfg.interval, cfg.period or f"{cfg.start}->{cfg.end}")
        df = _fetch_one(
            our, yt,
            interval=cfg.interval,
            period=cfg.period,
            start=cfg.start,
            end=cfg.end,
            retries=cfg.retries,
            sleep_seconds=cfg.sleep_seconds,
        )
        if not df.empty:
            frames.append(df)
            logger.info("  ... got %d rows for %s", len(df), our)
        time.sleep(cfg.sleep_seconds)

    if not frames:
        raise RuntimeError(
            "No data fetched for any symbol. Common causes: network blocked, "
            "Yahoo rate-limit, or all symbols invalid."
        )
    df = pd.concat(frames, ignore_index=True)

    if cfg.filter_session:
        t = df["timestamp"].dt.time
        start = pd.to_datetime(cfg.session_start).time()
        end = pd.to_datetime(cfg.session_end).time()
        mask = (t >= start) & (t <= end)
        dropped = (~mask).sum()
        if dropped:
            logger.info("Dropped %d rows outside session %s-%s",
                        dropped, cfg.session_start, cfg.session_end)
        df = df.loc[mask].copy()

    df = (
        df.drop_duplicates(subset=["timestamp", "symbol"], keep="last")
        .sort_values(["symbol", "timestamp"])
        .reset_index(drop=True)
    )
    return df


def save_csv(df: pd.DataFrame, cfg: FetchConfig) -> Path:
    """Write the fetched DataFrame to ``cfg.output_csv``, merging if requested."""
    out = Path(cfg.output_csv)
    out.parent.mkdir(parents=True, exist_ok=True)

    if cfg.append and out.exists():
        existing = pd.read_csv(out)
        existing["timestamp"] = pd.to_datetime(existing["timestamp"], errors="coerce")
        before = len(existing) + len(df)
        merged = (
            pd.concat([existing, df], ignore_index=True)
            .drop_duplicates(subset=["timestamp", "symbol"], keep="last")
            .sort_values(["symbol", "timestamp"])
            .reset_index(drop=True)
        )
        logger.info(
            "Merged with existing %s: %d -> %d rows after dedup.",
            out, before, len(merged),
        )
        merged.to_csv(out, index=False)
        return out

    df.to_csv(out, index=False)
    logger.info("Wrote %d rows to %s", len(df), out)
    return out


def fetch_and_save(cfg: FetchConfig) -> Path:
    df = fetch_data(cfg)
    return save_csv(df, cfg)


# ---------------------------------------------------------------------------
# Config dict -> FetchConfig
# ---------------------------------------------------------------------------

def config_from_dict(d: dict) -> FetchConfig:
    """Build a :class:`FetchConfig` from the ``fetch:`` block of the YAML config."""
    indices = dict(d.get("indices") or {})
    # Resolve friendly names that the user typed without a Yahoo ticker.
    resolved: dict[str, str] = {}
    for friendly, yticker in indices.items():
        f = friendly.upper()
        if yticker is None or str(yticker).strip() in {"", "null"}:
            if f in DEFAULT_INDEX_MAP:
                resolved[f] = DEFAULT_INDEX_MAP[f]
            else:
                raise ValueError(
                    f"Index {friendly!r} has no Yahoo ticker and no default known. "
                    f"Provide one explicitly, e.g. NIFTY50: '^NSEI'."
                )
        else:
            resolved[f] = str(yticker)

    return FetchConfig(
        stocks=list(d.get("stocks") or []),
        indices=resolved,
        interval=d.get("interval", "5m"),
        period=d.get("period", "60d"),
        start=d.get("start"),
        end=d.get("end"),
        output_csv=d.get("output_csv", "data/nse_intraday.csv"),
        append=bool(d.get("append", True)),
        filter_session=bool(d.get("filter_session", True)),
        session_start=d.get("session_start", "09:15"),
        session_end=d.get("session_end", "15:30"),
        retries=int(d.get("retries", 2)),
        sleep_seconds=float(d.get("sleep_seconds", 0.5)),
    )

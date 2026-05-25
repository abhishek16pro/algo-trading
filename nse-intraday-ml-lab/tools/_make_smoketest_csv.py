"""Generate a SYNTHETIC OHLCV CSV for smoke-testing the pipeline.

This is intentionally NOT part of the main package. It exists only so the
maintainer can verify the pipeline end-to-end without committing real market
data to the repo. It is NOT a market simulator and the data it produces
should never be used to evaluate a strategy or draw any trading conclusion.

Usage:
    python tools/_make_smoketest_csv.py --out data/smoketest.csv
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd


def _one_symbol_bars(
    symbol: str,
    n_days: int,
    bars_per_day: int,
    timeframe_min: int,
    start_date: pd.Timestamp,
    start_price: float,
    rng: np.random.Generator,
) -> pd.DataFrame:
    rows = []
    price = start_price
    for d in range(n_days):
        day = start_date + pd.Timedelta(days=d)
        if day.weekday() >= 5:  # skip weekends
            continue
        session_open = day + pd.Timedelta(hours=9, minutes=15)
        for b in range(bars_per_day):
            ts = session_open + pd.Timedelta(minutes=timeframe_min * b)
            # Geometric Brownian-ish with mild momentum + noise.
            drift = rng.normal(0, 0.0006)
            vol = abs(rng.normal(0, 0.0012))
            ret = drift + rng.normal(0, vol)
            new_close = max(0.01, price * (1.0 + ret))
            hi = max(price, new_close) * (1.0 + abs(rng.normal(0, 0.0005)))
            lo = min(price, new_close) * (1.0 - abs(rng.normal(0, 0.0005)))
            op = price
            cl = new_close
            volume = int(max(100, rng.lognormal(mean=10.5, sigma=0.4)))
            rows.append((ts.isoformat(), symbol, op, hi, lo, cl, volume))
            price = new_close
    return pd.DataFrame(rows, columns=["timestamp", "symbol", "open", "high", "low", "close", "volume"])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data/smoketest.csv")
    ap.add_argument("--days", type=int, default=120, help="calendar days of history")
    ap.add_argument("--timeframe-min", type=int, default=5)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    rng = np.random.default_rng(args.seed)
    bars_per_day = (6 * 60 + 15) // args.timeframe_min  # 09:15 -> 15:30 = 375 min
    start_date = pd.Timestamp("2025-01-06")  # a Monday

    pieces = []
    for sym, p0 in [("SYNTH_A", 1500.0), ("SYNTH_B", 850.0), ("SYNTH_C", 2400.0)]:
        pieces.append(
            _one_symbol_bars(
                symbol=sym,
                n_days=args.days,
                bars_per_day=bars_per_day,
                timeframe_min=args.timeframe_min,
                start_date=start_date,
                start_price=p0,
                rng=rng,
            )
        )
    df = pd.concat(pieces, ignore_index=True)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(out, index=False)
    print(f"Wrote {len(df):,} rows to {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

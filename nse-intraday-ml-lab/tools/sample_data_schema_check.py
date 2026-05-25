"""Standalone CSV schema validator for nse-intraday-ml-lab.

Usage:
    python tools/sample_data_schema_check.py --csv data/your_file.csv [--symbols RELIANCE INFY]

It performs the same validation as ``src.data_loader.load_csv`` but is safe to
run without touching the rest of the pipeline. Useful as a pre-flight check
before you commit to a long preprocess/train run.

It does NOT generate synthetic market data.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Make src importable without installing the package
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.data_loader import load_csv  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description="Validate intraday OHLCV CSV.")
    ap.add_argument("--csv", required=True, help="Path to CSV file")
    ap.add_argument("--symbols", nargs="*", default=None, help="Optional symbol filter")
    ap.add_argument("--timeframe", default="5min", choices=["1min", "5min", "15min"])
    ap.add_argument("--session-start", default=None, help="HH:MM (e.g., 09:15)")
    ap.add_argument("--session-end", default=None, help="HH:MM (e.g., 15:30)")
    args = ap.parse_args()

    try:
        df, report = load_csv(
            args.csv,
            symbols=args.symbols,
            timeframe=args.timeframe,
            session_start=args.session_start,
            session_end=args.session_end,
        )
    except Exception as exc:
        print(f"[FAIL] {type(exc).__name__}: {exc}")
        return 2

    print("[OK] Loader summary:")
    for k, v in report.as_dict().items():
        print(f"  - {k}: {v}")

    print("\nFirst 3 rows after cleaning:")
    print(df.head(3).to_string(index=False))
    print(f"\nTotal rows: {len(df):,}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

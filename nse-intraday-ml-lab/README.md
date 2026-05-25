# nse-intraday-ml-lab

An **educational** lab for building, evaluating, and paper-trading intraday machine-learning
signals on NSE (or any) OHLCV bar data. The pipeline emphasizes the things that *usually*
trip up new quants:

- leak-free feature engineering
- triple-barrier and direction labeling
- walk-forward validation (no random K-fold)
- realistic transaction-cost backtesting (next-bar execution)
- risk controls and daily loss circuit-breaker

> ⚠️ **Disclaimer.** This project is for learning and research. It is **not** financial advice,
> it does **not** connect to any broker, and it makes **no** claims about profitability.
> Markets are adversarial and most retail ML strategies fail in live trading. Use this code
> only with paper trading and historical research.

---

## Repo layout

```
nse-intraday-ml-lab/
├── README.md
├── requirements.txt
├── configs/
│   └── config.yaml
├── src/
│   ├── __init__.py
│   ├── data_collector.py   # fetch NSE intraday data via yfinance
│   ├── data_loader.py
│   ├── features.py
│   ├── labeling.py
│   ├── splits.py
│   ├── modeling.py
│   ├── strategy.py
│   ├── backtest.py
│   ├── report.py
│   └── cli.py
├── tools/
│   └── sample_data_schema_check.py
├── data/              # put your CSVs here
├── artifacts/         # models, preprocessed data, fold metrics
└── reports/           # generated reports (html/md, plots)
```

---

## Setup

Python 3.10+ recommended.

```bash
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
```

Optional: `xgboost` is listed but the code falls back to scikit-learn's
`GradientBoostingClassifier` automatically if it cannot be imported.

---

## Expected CSV schema

Each row is one intraday bar:

| column     | type    | notes                                   |
|------------|---------|-----------------------------------------|
| timestamp  | ISO 8601 string or parseable datetime  | tz-naive (assumed IST) or tz-aware |
| symbol     | string  | e.g., `RELIANCE`, `INFY`                |
| open       | float   | bar open                                |
| high       | float   | bar high                                |
| low        | float   | bar low                                 |
| close      | float   | bar close                               |
| volume     | float/int | bar volume                            |

- The loader sorts by `(symbol, timestamp)`, drops exact duplicate rows, and flags
  irregular bar spacing (it does not fabricate missing bars — that is left to you).
- Supported timeframes are configured in `configs/config.yaml` (`1min` or `5min`).

Validate any file before training:

```bash
python tools/sample_data_schema_check.py --csv data/your_file.csv
```

---

## Quick start

You have two options for getting data: **fetch** it via the built-in yfinance
collector, or **bring your own** CSV.

### Option A — fetch from Yahoo Finance

1. Edit `configs/config.yaml`, specifically the `fetch:` block (list stocks
   under `fetch.stocks`, indices under `fetch.indices`).
2. Run the pipeline:

```bash
python -m src.cli fetch      --config configs/config.yaml
python -m src.cli preprocess --config configs/config.yaml
python -m src.cli train      --config configs/config.yaml
python -m src.cli backtest   --config configs/config.yaml
python -m src.cli report     --config configs/config.yaml
```

Yahoo intraday limits: `1m` → last 7 days, `5m / 15m / 30m / 90m` → last 60
days, `60m / 1h` → last 730 days. Stocks are addressed as bare NSE symbols
(`RELIANCE`, `INFY`, ...) — the collector appends `.NS` automatically.
Indices use Yahoo tickers (`^NSEI` Nifty 50, `^NSEBANK` Bank Nifty,
`^CNXIT` Nifty IT, `^CNXFIN` Nifty Fin, `^INDIAVIX` India VIX). A handful of
friendly aliases (`NIFTY50`, `BANKNIFTY`, `NIFTYIT`, `NIFTYFIN`, `INDIAVIX`) work
out of the box.

### Option B — bring your own CSV

1. Drop your CSV into `data/`, e.g. `data/nse_intraday.csv`.
2. In `configs/config.yaml`, set `data.csv_path` to point at it.
3. Skip the `fetch` step; run `preprocess` onward.

### Choosing which symbols the *pipeline* uses

`fetch.stocks` and `fetch.indices` control what gets *downloaded*. To train on
only a subset of what's in the CSV, set `data.symbols` (empty list = use
everything). You can mix stocks and indices freely — they're just rows with
distinct `symbol` values.

Each step writes artifacts under `artifacts/` and the final HTML/Markdown report
lands in `reports/`.

---

## What the pipeline does

1. **preprocess** — loads the CSV, validates schema, builds features per symbol
   (log returns at 1/5/15 bars, rolling vol, ATR, RSI, MACD, MA distances, volume
   z-score, time-of-day sin/cos), then writes `artifacts/features.parquet`.
2. **train** — generates walk-forward folds (expanding or rolling), trains a
   baseline (`logreg` or `gbm`/`xgb`), evaluates AUC/accuracy per fold, optionally
   calibrates probabilities, and saves models + per-fold metrics.
3. **backtest** — for each fold, simulates trading on the *test* window only,
   using signals from bar close but executing at the **next** bar's open. Applies
   commission, spread, and slippage costs. Risk-sizes by fixed fractional equity,
   enforces max positions per symbol, and trips a daily loss circuit-breaker.
4. **report** — writes a Markdown/HTML report with parameters, per-fold metrics,
   confusion matrices, equity curve, and drawdown plot.

---

## Plugging in your NSE intraday CSV

- Convert your broker / data-vendor export to the schema above. Common gotchas:
  - timestamps in `dd-mm-yyyy hh:mm` need parsing — let pandas infer or pass a
    `parse_dates` format. The loader uses `pd.to_datetime(..., errors='raise')`.
  - mixing pre-market / post-market bars can wreck features; filter to the
    regular session (09:15–15:30 IST) yourself before saving.
  - corporate actions: ML on raw close prices around splits/bonuses is junk.
    Use adjusted intraday data if you have it, or exclude affected dates.

---

## Tuning thresholds & costs *safely*

- **Never** tune thresholds on the same window you evaluate on. The walk-forward
  splitter already separates train/val/test — use validation folds to choose
  `entry_threshold`, then hold out test untouched.
- Start with **pessimistic** cost assumptions (`spread_bps=5`, `slippage_bps=5`,
  `commission_per_trade=20`) and *lower* them only if you can justify it for
  your broker/symbol. A strategy that only works at zero cost is not a strategy.
- Sweep thresholds coarsely (e.g., 0.50 → 0.65 in 0.025 steps). If the curve is
  not flat-ish across nearby thresholds, you're probably overfitting.

---

## Common pitfalls

- **Look-ahead bias.** The classic killer. This repo defends against it by:
  (a) computing features with `shift()`/rolling on past bars only, (b) executing
  trades at *next* bar open, and (c) walk-forward folds where test always
  follows train in time. Still — every time you add a feature, ask "could this
  value have been known at the bar's close?"
- **Survivorship bias.** If your CSV only contains symbols currently in NIFTY 50,
  you're already cheating: failed/delisted symbols are invisible. Pull historical
  index constituents if you care about realism.
- **Transaction-cost neglect.** Intraday alpha is small. A 3 bps edge dies under
  10 bps of round-trip cost. Always include commission + spread + slippage.
- **Overfitting to one period.** A single backtest is one sample. Look at fold
  dispersion, not just the mean. If fold-to-fold Sharpe ranges from -1 to +3,
  the +3 is luck.
- **Multiple-testing.** Trying 200 feature combinations and reporting the best
  is *p-hacking*. Pre-register your hypothesis or use nested CV.
- **Regime change.** A model trained on 2022 may be irrelevant in 2025. Walk-
  forward partially mitigates this; static train/test does not.

---

## License & ethics

MIT for the code. The data you supply is your responsibility — respect your
exchange/data-vendor license. Don't use this to give other people trading advice.

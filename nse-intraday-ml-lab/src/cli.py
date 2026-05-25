"""Command-line interface for the lab.

Sub-commands
------------
- ``preprocess`` : load CSV, build features, write Parquet to ``artifacts/``.
- ``train``      : walk-forward train; save models + per-fold validation metrics.
- ``backtest``   : run the backtester on each fold's test window.
- ``report``     : write a Markdown/HTML report from artifacts.

Each command takes ``--config configs/config.yaml``.
"""

from __future__ import annotations

import argparse
import json
import logging
import random
import sys
from dataclasses import asdict
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
import yaml
from sklearn.metrics import accuracy_score, confusion_matrix, roc_auc_score

from .backtest import run_backtest
from .data_collector import config_from_dict as fetch_config_from_dict, fetch_and_save
from .data_loader import load_csv
from .features import FeatureConfig, assert_no_leakage, create_features
from .labeling import LabelingConfig, make_labels
from .modeling import ModelConfig, predict_proba, train_model
from .report import ReportConfig, write_report
from .splits import SplitConfig, walk_forward_folds
from .strategy import CostConfig, RiskConfig, StrategyConfig

logger = logging.getLogger("nse-intraday-ml-lab")


# ---------------------------------------------------------------------------
# Config plumbing
# ---------------------------------------------------------------------------

def _load_config(path: str | Path) -> dict[str, Any]:
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def _set_seed(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)


def _paths(cfg: dict) -> dict[str, Path]:
    art = Path(cfg["output"]["artifacts_dir"])
    rep = Path(cfg["output"]["reports_dir"])
    art.mkdir(parents=True, exist_ok=True)
    rep.mkdir(parents=True, exist_ok=True)
    return {
        "artifacts": art,
        "reports": rep,
        "features": art / "features.parquet",
        "labels": art / "labels.parquet",
        "folds": art / "folds.json",
        "models_dir": art / "models",
        "fold_preds": art / "fold_predictions.parquet",
        "fold_metrics": art / "fold_metrics.json",
    }


def _setup_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
        datefmt="%H:%M:%S",
    )


# ---------------------------------------------------------------------------
# fetch
# ---------------------------------------------------------------------------

def cmd_fetch(args: argparse.Namespace) -> None:
    cfg = _load_config(args.config)
    if "fetch" not in cfg:
        raise SystemExit(
            "Config is missing a 'fetch:' block. See configs/config.yaml for an example."
        )
    fcfg = fetch_config_from_dict(cfg["fetch"])
    out = fetch_and_save(fcfg)
    logger.info("Fetched dataset written to %s", out)


# ---------------------------------------------------------------------------
# preprocess
# ---------------------------------------------------------------------------

def cmd_preprocess(args: argparse.Namespace) -> None:
    cfg = _load_config(args.config)
    _set_seed(cfg.get("seed", 42))
    paths = _paths(cfg)

    data_cfg = cfg["data"]
    df, report = load_csv(
        data_cfg["csv_path"],
        symbols=data_cfg.get("symbols") or None,
        timeframe=data_cfg.get("timeframe", "5min"),
        session_start=data_cfg.get("session_start"),
        session_end=data_cfg.get("session_end"),
    )
    logger.info("Loaded data: %s", report.as_dict())

    feat_cfg = FeatureConfig(
        return_lags=tuple(cfg["features"]["return_lags"]),
        vol_window=cfg["features"]["vol_window"],
        atr_window=cfg["features"]["atr_window"],
        rsi_window=cfg["features"]["rsi_window"],
        macd_fast=cfg["features"]["macd_fast"],
        macd_slow=cfg["features"]["macd_slow"],
        macd_signal=cfg["features"]["macd_signal"],
        ma_windows=tuple(cfg["features"]["ma_windows"]),
        volume_z_window=cfg["features"]["volume_z_window"],
        timeframe=data_cfg.get("timeframe", "5min"),
    )
    feats = create_features(df, feat_cfg)
    assert_no_leakage(feats, df)
    logger.info("Features built: rows=%d cols=%d", len(feats), len(feat_cfg.feature_columns_))

    lab_cfg = LabelingConfig(
        method=cfg["labeling"]["method"],
        horizon=cfg["labeling"]["horizon"],
        take_profit_atr=cfg["labeling"]["take_profit_atr"],
        stop_loss_atr=cfg["labeling"]["stop_loss_atr"],
    )
    y = make_labels(feats, lab_cfg)
    feats = feats.assign(y=y)

    n_before = len(feats)
    feats = feats.dropna(subset=["y"]).reset_index(drop=True)
    feats["y"] = feats["y"].astype(int)
    logger.info("Labeling dropped %d tail rows; %d remain.", n_before - len(feats), len(feats))

    feats.to_parquet(paths["features"], index=False)
    # save feature column list for downstream commands
    (paths["artifacts"] / "feature_columns.json").write_text(
        json.dumps(feat_cfg.feature_columns_), encoding="utf-8"
    )
    logger.info("Wrote features -> %s", paths["features"])


# ---------------------------------------------------------------------------
# train
# ---------------------------------------------------------------------------

def cmd_train(args: argparse.Namespace) -> None:
    cfg = _load_config(args.config)
    _set_seed(cfg.get("seed", 42))
    paths = _paths(cfg)
    paths["models_dir"].mkdir(parents=True, exist_ok=True)

    feats = pd.read_parquet(paths["features"])
    feature_cols = json.loads((paths["artifacts"] / "feature_columns.json").read_text())

    sp_cfg = SplitConfig(**cfg["splits"])
    folds = list(walk_forward_folds(feats["timestamp"], sp_cfg))
    if not folds:
        raise RuntimeError(
            "No folds produced. Increase data range or reduce train/val/test days."
        )
    logger.info("Generated %d folds.", len(folds))

    model_cfg = ModelConfig(
        name=cfg["model"]["name"],
        calibrate=cfg["model"]["calibrate"],
        calibration_method=cfg["model"]["calibration_method"],
        seed=cfg.get("seed", 42),
        params=cfg["model"].get(cfg["model"]["name"], {}),
    )

    all_preds: list[pd.DataFrame] = []
    fold_metrics: list[dict] = []

    for fold in folds:
        tr_mask = fold.mask(feats["timestamp"], "train")
        va_mask = fold.mask(feats["timestamp"], "val")
        te_mask = fold.mask(feats["timestamp"], "test")

        Xtr, ytr = feats.loc[tr_mask, feature_cols], feats.loc[tr_mask, "y"]
        Xva, yva = feats.loc[va_mask, feature_cols], feats.loc[va_mask, "y"]
        Xte, yte = feats.loc[te_mask, feature_cols], feats.loc[te_mask, "y"]

        if Xtr.empty or Xte.empty:
            logger.warning("Fold %d skipped (empty train or test).", fold.fold_id)
            continue
        if ytr.nunique() < 2:
            logger.warning("Fold %d skipped (only one class in train).", fold.fold_id)
            continue

        model = train_model(Xtr, ytr, Xva if not Xva.empty else None,
                            yva if not yva.empty else None, model_cfg)
        joblib.dump(model, paths["models_dir"] / f"model_fold_{fold.fold_id}.joblib")

        p_test = predict_proba(model, Xte)
        preds = pd.DataFrame({
            "fold_id": fold.fold_id,
            "timestamp": feats.loc[te_mask, "timestamp"].values,
            "symbol": feats.loc[te_mask, "symbol"].values,
            "y_true": yte.values,
            "p_up": p_test,
        })
        all_preds.append(preds)

        # Metrics
        try:
            auc = roc_auc_score(yte.values, p_test)
        except Exception:
            auc = float("nan")
        y_pred = (p_test >= 0.5).astype(int)
        acc = accuracy_score(yte.values, y_pred) if len(yte) else float("nan")
        cm = confusion_matrix(yte.values, y_pred, labels=[0, 1]).tolist() if len(yte) else None

        fold_metrics.append({
            **fold.as_dict(),
            "n_train": int(tr_mask.sum()),
            "n_val": int(va_mask.sum()),
            "n_test": int(te_mask.sum()),
            "auc": float(auc),
            "accuracy": float(acc),
            "confusion_matrix": cm,
        })
        logger.info("Fold %d  AUC=%.3f Acc=%.3f  n_test=%d",
                    fold.fold_id, auc, acc, int(te_mask.sum()))

    if not all_preds:
        raise RuntimeError("No usable folds — check data and config.")

    pd.concat(all_preds, ignore_index=True).to_parquet(paths["fold_preds"], index=False)
    paths["fold_metrics"].write_text(json.dumps(fold_metrics, indent=2), encoding="utf-8")
    paths["folds"].write_text(json.dumps([f.as_dict() for f in folds], indent=2), encoding="utf-8")
    logger.info("Wrote predictions -> %s", paths["fold_preds"])


# ---------------------------------------------------------------------------
# backtest
# ---------------------------------------------------------------------------

def cmd_backtest(args: argparse.Namespace) -> None:
    cfg = _load_config(args.config)
    _set_seed(cfg.get("seed", 42))
    paths = _paths(cfg)

    feats = pd.read_parquet(paths["features"])
    preds = pd.read_parquet(paths["fold_preds"])
    fold_metrics = json.loads(paths["fold_metrics"].read_text())

    strat = StrategyConfig(**cfg["strategy"])
    risk = RiskConfig(**cfg["risk"])
    costs = CostConfig(**cfg["costs"])

    # Merge predictions back onto features for OHLC + ATR.
    merged = preds.merge(
        feats[["timestamp", "symbol", "open", "high", "low", "close", "atr"]],
        on=["timestamp", "symbol"],
        how="left",
        validate="one_to_one",
    )

    all_trades: list[pd.DataFrame] = []
    all_equity: list[pd.DataFrame] = []
    starting_equity = risk.starting_equity
    running_equity = starting_equity

    enriched_metrics: list[dict] = []
    for m in fold_metrics:
        fold_id = m["fold_id"]
        sub = merged[merged["fold_id"] == fold_id].sort_values(["timestamp", "symbol"])
        if sub.empty:
            enriched_metrics.append(m)
            continue

        # Stitch equity continuously across folds by carrying running_equity forward.
        risk_fold = RiskConfig(**{**asdict(risk), "starting_equity": running_equity})
        result = run_backtest(
            sub.drop(columns=["fold_id"]),
            sub["p_up"],
            strategy=strat,
            risk=risk_fold,
            costs=costs,
        )
        if not result.trades.empty:
            result.trades["fold_id"] = fold_id
            all_trades.append(result.trades)
        if not result.equity_curve.empty:
            result.equity_curve["fold_id"] = fold_id
            all_equity.append(result.equity_curve)
            running_equity = float(result.equity_curve["equity"].iloc[-1])
        enriched_metrics.append({**m, **result.summary})

    combined_trades = (
        pd.concat(all_trades, ignore_index=True) if all_trades else pd.DataFrame()
    )
    combined_equity = (
        pd.concat(all_equity, ignore_index=True) if all_equity else pd.DataFrame()
    )

    if not combined_equity.empty:
        combined_equity = combined_equity.sort_values("timestamp").reset_index(drop=True)
    combined_summary = _combined_summary(combined_trades, combined_equity, starting_equity)

    paths["fold_metrics"].write_text(json.dumps(enriched_metrics, indent=2, default=str),
                                     encoding="utf-8")
    if not combined_trades.empty:
        combined_trades.to_parquet(paths["artifacts"] / "trades.parquet", index=False)
    if not combined_equity.empty:
        combined_equity.to_parquet(paths["artifacts"] / "equity_curve.parquet", index=False)
    (paths["artifacts"] / "combined_summary.json").write_text(
        json.dumps(combined_summary, indent=2, default=str), encoding="utf-8"
    )
    logger.info("Backtest done. Summary: %s", combined_summary)


def _combined_summary(trades: pd.DataFrame, equity: pd.DataFrame, starting_equity: float) -> dict:
    if equity.empty:
        return {"trades": 0, "final_equity": starting_equity}
    eq = equity["equity"].values
    final_equity = float(eq[-1])
    total_return = final_equity / starting_equity - 1.0
    peak = np.maximum.accumulate(eq)
    dd = (eq - peak) / peak
    max_dd = float(dd.min()) if len(dd) else 0.0
    daily = (
        equity.assign(day=equity["timestamp"].dt.normalize())
        .groupby("day")["equity"]
        .last()
        .pct_change()
        .dropna()
    )
    sharpe = float(np.sqrt(252) * daily.mean() / daily.std(ddof=1)) if len(daily) > 1 and daily.std(ddof=1) > 0 else 0.0
    n = int(len(trades))
    return {
        "trades": n,
        "starting_equity": starting_equity,
        "final_equity": final_equity,
        "total_return": total_return,
        "sharpe_daily_ann": sharpe,
        "max_drawdown": max_dd,
        "win_rate": float((trades["net_pnl"] > 0).mean()) if n else 0.0,
        "avg_trade_pnl": float(trades["net_pnl"].mean()) if n else 0.0,
    }


# ---------------------------------------------------------------------------
# report
# ---------------------------------------------------------------------------

def cmd_report(args: argparse.Namespace) -> None:
    cfg = _load_config(args.config)
    paths = _paths(cfg)
    fold_metrics = json.loads(paths["fold_metrics"].read_text())

    trades_path = paths["artifacts"] / "trades.parquet"
    eq_path = paths["artifacts"] / "equity_curve.parquet"
    summary_path = paths["artifacts"] / "combined_summary.json"

    trades = pd.read_parquet(trades_path) if trades_path.exists() else pd.DataFrame()
    equity = pd.read_parquet(eq_path) if eq_path.exists() else pd.DataFrame()
    summary = json.loads(summary_path.read_text()) if summary_path.exists() else {}

    out_cfg = ReportConfig(
        artifacts_dir=paths["artifacts"],
        reports_dir=paths["reports"],
        format=cfg["output"].get("report_format", "markdown"),
    )
    write_report(
        config=cfg,
        fold_metrics=fold_metrics,
        combined_trades=trades,
        combined_equity=equity,
        combined_summary=summary,
        out_cfg=out_cfg,
    )


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="nse-intraday-ml-lab pipeline")
    sub = p.add_subparsers(dest="cmd", required=True)

    for name, fn in [
        ("fetch", cmd_fetch),
        ("preprocess", cmd_preprocess),
        ("train", cmd_train),
        ("backtest", cmd_backtest),
        ("report", cmd_report),
    ]:
        sp = sub.add_parser(name, help=f"run {name} stage")
        sp.add_argument("--config", required=True, help="path to YAML config")
        sp.set_defaults(func=fn)
    return p


def main(argv: list[str] | None = None) -> int:
    _setup_logging()
    args = build_parser().parse_args(argv)
    args.func(args)
    return 0


if __name__ == "__main__":
    sys.exit(main())

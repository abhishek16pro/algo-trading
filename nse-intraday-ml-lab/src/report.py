"""Generate per-fold and combined reports (Markdown or HTML)."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # headless
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


@dataclass
class ReportConfig:
    artifacts_dir: Path
    reports_dir: Path
    format: str = "markdown"  # "markdown" or "html"


# ---------------------------------------------------------------------------
# Plots
# ---------------------------------------------------------------------------

def _plot_equity_and_drawdown(eq: pd.DataFrame, path: Path) -> None:
    if eq.empty:
        return
    eq = eq.copy()
    eq["timestamp"] = pd.to_datetime(eq["timestamp"])
    eq = eq.sort_values("timestamp")
    peak = eq["equity"].cummax()
    dd = (eq["equity"] - peak) / peak

    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(10, 6), sharex=True)
    ax1.plot(eq["timestamp"], eq["equity"], color="tab:blue")
    ax1.set_title("Equity curve")
    ax1.set_ylabel("Equity")
    ax1.grid(True, alpha=0.3)

    ax2.fill_between(eq["timestamp"], dd, 0, color="tab:red", alpha=0.4)
    ax2.set_title("Drawdown")
    ax2.set_ylabel("Drawdown")
    ax2.grid(True, alpha=0.3)
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close(fig)


def _plot_confusion(cm: np.ndarray, path: Path) -> None:
    fig, ax = plt.subplots(figsize=(4, 4))
    im = ax.imshow(cm, cmap="Blues")
    ax.set_xticks([0, 1])
    ax.set_yticks([0, 1])
    ax.set_xticklabels(["pred 0", "pred 1"])
    ax.set_yticklabels(["true 0", "true 1"])
    for i in range(2):
        for j in range(2):
            ax.text(j, i, str(cm[i, j]), ha="center", va="center",
                    color="black" if cm[i, j] < cm.max() / 2 else "white")
    ax.set_title("Confusion matrix")
    fig.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close(fig)


# ---------------------------------------------------------------------------
# Report writers
# ---------------------------------------------------------------------------

def _format_metric(v) -> str:
    if isinstance(v, float):
        if np.isnan(v) or np.isinf(v):
            return "—"
        if abs(v) < 1e-3 or abs(v) >= 1e6:
            return f"{v:.3e}"
        return f"{v:,.4f}"
    return str(v)


def _markdown_table(rows: list[dict], columns: list[str]) -> str:
    out = ["| " + " | ".join(columns) + " |", "| " + " | ".join(["---"] * len(columns)) + " |"]
    for r in rows:
        out.append("| " + " | ".join(_format_metric(r.get(c)) for c in columns) + " |")
    return "\n".join(out)


def write_report(
    *,
    config: dict,
    fold_metrics: list[dict],
    combined_trades: pd.DataFrame,
    combined_equity: pd.DataFrame,
    combined_summary: dict,
    out_cfg: ReportConfig,
) -> Path:
    out_cfg.reports_dir.mkdir(parents=True, exist_ok=True)
    plots_dir = out_cfg.reports_dir / "plots"
    plots_dir.mkdir(exist_ok=True)

    eq_plot = plots_dir / "equity_drawdown.png"
    _plot_equity_and_drawdown(combined_equity, eq_plot)

    # Per-fold confusion matrices
    cm_paths: list[Path] = []
    for m in fold_metrics:
        cm = m.get("confusion_matrix")
        if cm is None:
            continue
        cm_path = plots_dir / f"cm_fold_{m['fold_id']}.png"
        _plot_confusion(np.array(cm), cm_path)
        cm_paths.append(cm_path)

    md_lines: list[str] = []
    md_lines.append("# nse-intraday-ml-lab — Backtest Report\n")
    md_lines.append("> ⚠️ Educational only. Not financial advice. Paper trading.\n")
    md_lines.append("## Configuration\n")
    md_lines.append("```yaml\n" + _yaml_dump(config) + "\n```\n")

    md_lines.append("## Per-fold metrics\n")
    cols = ["fold_id", "test_start", "test_end", "n_test", "auc", "accuracy",
            "trades", "final_equity", "total_return", "sharpe_daily_ann", "max_drawdown",
            "win_rate", "profit_factor"]
    md_lines.append(_markdown_table(fold_metrics, cols))
    md_lines.append("")

    md_lines.append("## Combined performance\n")
    md_lines.append(_markdown_table([combined_summary],
                                    list(combined_summary.keys())))
    md_lines.append("")

    md_lines.append("## Equity & Drawdown\n")
    md_lines.append(f"![equity_drawdown](plots/{eq_plot.name})\n")

    if cm_paths:
        md_lines.append("## Confusion matrices (per fold)\n")
        for p in cm_paths:
            md_lines.append(f"![{p.stem}](plots/{p.name})\n")

    md_lines.append("## Notes\n")
    md_lines.append(
        "- All trades execute at the next bar's open after a signal.\n"
        "- Costs include commission, half-spread per leg, and slippage.\n"
        "- Walk-forward only; train/val/test never overlap in time.\n"
    )

    md_text = "\n".join(md_lines)

    if out_cfg.format == "html":
        report_path = out_cfg.reports_dir / "report.html"
        report_path.write_text(_markdown_to_html(md_text), encoding="utf-8")
    else:
        report_path = out_cfg.reports_dir / "report.md"
        report_path.write_text(md_text, encoding="utf-8")

    # Also dump machine-readable metrics.
    (out_cfg.reports_dir / "fold_metrics.json").write_text(
        json.dumps(fold_metrics, indent=2, default=str), encoding="utf-8"
    )
    (out_cfg.reports_dir / "summary.json").write_text(
        json.dumps(combined_summary, indent=2, default=str), encoding="utf-8"
    )
    if not combined_trades.empty:
        combined_trades.to_csv(out_cfg.reports_dir / "trades.csv", index=False)
    if not combined_equity.empty:
        combined_equity.to_csv(out_cfg.reports_dir / "equity_curve.csv", index=False)

    logger.info("Report written to %s", report_path)
    return report_path


def _yaml_dump(obj) -> str:
    try:
        import yaml
        return yaml.safe_dump(obj, sort_keys=False)
    except Exception:
        return json.dumps(obj, indent=2, default=str)


def _markdown_to_html(md_text: str) -> str:
    """Very small Markdown-to-HTML wrapper. We don't depend on `markdown` lib;
    instead we embed the raw markdown inside <pre> for fidelity, plus link
    images so they still render.
    """
    body = (
        md_text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    )
    # Re-enable image markdown -> <img>
    import re
    body = re.sub(
        r"!\[([^\]]*)\]\(([^)]+)\)",
        r'<img alt="\1" src="\2" style="max-width:100%;">',
        body,
    )
    return (
        "<!doctype html><html><head><meta charset='utf-8'>"
        "<title>nse-intraday-ml-lab report</title>"
        "<style>body{font-family:system-ui,Arial,sans-serif;max-width:980px;margin:2em auto;padding:0 1em;}"
        "pre{white-space:pre-wrap;}</style></head><body><pre>" + body + "</pre></body></html>"
    )

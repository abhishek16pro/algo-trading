"""Walk-forward time-series splits.

Random k-fold on time series is the most common reason published backtests
don't replicate. This module provides expanding- and rolling-window splits
that respect time ordering: train ends strictly before val, val ends strictly
before test, and folds advance forward in time.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterator

import numpy as np
import pandas as pd


@dataclass
class SplitConfig:
    scheme: str = "expanding"   # "expanding" or "rolling"
    train_days: int = 60
    val_days: int = 10
    test_days: int = 10
    step_days: int = 10
    min_train_days: int = 30


@dataclass
class Fold:
    fold_id: int
    train_start: pd.Timestamp
    train_end: pd.Timestamp     # inclusive
    val_start: pd.Timestamp
    val_end: pd.Timestamp       # inclusive
    test_start: pd.Timestamp
    test_end: pd.Timestamp      # inclusive

    def as_dict(self) -> dict:
        return {
            "fold_id": self.fold_id,
            "train_start": str(self.train_start),
            "train_end": str(self.train_end),
            "val_start": str(self.val_start),
            "val_end": str(self.val_end),
            "test_start": str(self.test_start),
            "test_end": str(self.test_end),
        }

    def mask(self, ts: pd.Series, which: str) -> pd.Series:
        """Return a boolean mask over a timestamp Series for the given window."""
        if which == "train":
            return (ts >= self.train_start) & (ts <= self.train_end)
        if which == "val":
            return (ts >= self.val_start) & (ts <= self.val_end)
        if which == "test":
            return (ts >= self.test_start) & (ts <= self.test_end)
        raise ValueError(f"unknown window {which!r}")


def _calendar_days(timestamps: pd.Series) -> pd.DatetimeIndex:
    """Unique dates present in the data, sorted."""
    return pd.DatetimeIndex(sorted(timestamps.dt.normalize().unique()))


def walk_forward_folds(timestamps: pd.Series, cfg: SplitConfig) -> Iterator[Fold]:
    """Yield :class:`Fold` records for the given timestamp Series.

    Folds are produced in chronological order. For ``scheme="expanding"`` each
    fold's training window starts at the first available date and ends just
    before its validation window. For ``scheme="rolling"`` the training window
    has a fixed length of ``train_days``.
    """
    if cfg.scheme not in {"expanding", "rolling"}:
        raise ValueError(f"unknown split scheme {cfg.scheme!r}")

    days = _calendar_days(timestamps)
    if len(days) == 0:
        return

    one_day = pd.Timedelta(days=1)
    n = len(days)

    # Fold k starts test window at index `t_start_idx`. Walk it forward by step_days.
    fold_id = 0
    # Initial pointer: earliest test_start such that we have train_days + val_days behind it.
    initial_offset = cfg.train_days + cfg.val_days
    if cfg.scheme == "expanding":
        initial_offset = max(initial_offset, cfg.min_train_days + cfg.val_days)
    t_idx = initial_offset

    while t_idx + cfg.test_days <= n:
        test_start = days[t_idx]
        test_end = days[min(t_idx + cfg.test_days - 1, n - 1)]
        val_end = days[t_idx - 1]
        val_start = days[t_idx - cfg.val_days]
        train_end = days[t_idx - cfg.val_days - 1]
        if cfg.scheme == "expanding":
            train_start = days[0]
            train_len_days = (train_end - train_start) / one_day + 1
            if train_len_days < cfg.min_train_days:
                t_idx += cfg.step_days
                continue
        else:  # rolling
            train_start_idx = t_idx - cfg.val_days - cfg.train_days
            if train_start_idx < 0:
                t_idx += cfg.step_days
                continue
            train_start = days[train_start_idx]

        yield Fold(
            fold_id=fold_id,
            train_start=train_start,
            train_end=train_end + (one_day - pd.Timedelta(seconds=1)),
            val_start=val_start,
            val_end=val_end + (one_day - pd.Timedelta(seconds=1)),
            test_start=test_start,
            test_end=test_end + (one_day - pd.Timedelta(seconds=1)),
        )
        fold_id += 1
        t_idx += cfg.step_days


def split_indices(
    df: pd.DataFrame, fold: Fold, ts_col: str = "timestamp"
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return ``(train_idx, val_idx, test_idx)`` integer arrays for a fold."""
    ts = df[ts_col]
    tr = np.where(fold.mask(ts, "train"))[0]
    va = np.where(fold.mask(ts, "val"))[0]
    te = np.where(fold.mask(ts, "test"))[0]
    return tr, va, te

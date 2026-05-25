"""Baseline classification models with optional probability calibration."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

logger = logging.getLogger(__name__)

try:
    import xgboost as xgb  # type: ignore
    _HAS_XGB = True
except Exception:  # pragma: no cover - optional dep
    _HAS_XGB = False

try:  # sklearn >= 1.6
    from sklearn.frozen import FrozenEstimator  # type: ignore
    _HAS_FROZEN = True
except Exception:  # pragma: no cover - older sklearn
    FrozenEstimator = None  # type: ignore
    _HAS_FROZEN = False


@dataclass
class ModelConfig:
    name: str = "gbm"
    calibrate: bool = True
    calibration_method: str = "isotonic"
    seed: int = 42
    params: dict[str, Any] = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        if self.params is None:
            self.params = {}


def _build_estimator(cfg: ModelConfig):
    name = cfg.name.lower()
    if name == "logreg":
        return Pipeline(
            [
                ("scaler", StandardScaler()),
                (
                    "clf",
                    LogisticRegression(
                        C=cfg.params.get("C", 1.0),
                        max_iter=cfg.params.get("max_iter", 1000),
                        random_state=cfg.seed,
                    ),
                ),
            ]
        )
    if name == "gbm":
        return GradientBoostingClassifier(
            n_estimators=cfg.params.get("n_estimators", 200),
            max_depth=cfg.params.get("max_depth", 3),
            learning_rate=cfg.params.get("learning_rate", 0.05),
            subsample=cfg.params.get("subsample", 0.8),
            random_state=cfg.seed,
        )
    if name == "xgb":
        if not _HAS_XGB:
            logger.warning("xgboost not installed; falling back to sklearn GBM.")
            return _build_estimator(ModelConfig(name="gbm", seed=cfg.seed, params=cfg.params))
        return xgb.XGBClassifier(
            n_estimators=cfg.params.get("n_estimators", 400),
            max_depth=cfg.params.get("max_depth", 4),
            learning_rate=cfg.params.get("learning_rate", 0.05),
            subsample=cfg.params.get("subsample", 0.8),
            colsample_bytree=cfg.params.get("colsample_bytree", 0.8),
            reg_lambda=cfg.params.get("reg_lambda", 1.0),
            tree_method=cfg.params.get("tree_method", "hist"),
            objective="binary:logistic",
            eval_metric="logloss",
            random_state=cfg.seed,
            n_jobs=cfg.params.get("n_jobs", 0),
        )
    raise ValueError(f"unknown model {cfg.name!r}")


def train_model(
    X_train: pd.DataFrame,
    y_train: pd.Series,
    X_val: pd.DataFrame | None,
    y_val: pd.Series | None,
    cfg: ModelConfig,
):
    """Fit an estimator on (X_train, y_train), optionally calibrate on validation.

    Returns a fitted estimator with a ``predict_proba`` method.
    """
    est = _build_estimator(cfg)
    est.fit(X_train.values, y_train.values.astype(int))

    if cfg.calibrate and X_val is not None and y_val is not None and len(X_val) > 50:
        try:
            if _HAS_FROZEN:
                # sklearn >= 1.6: wrap the already-fit estimator so the CV
                # calibrator does not refit it.
                base = FrozenEstimator(est)  # type: ignore[misc]
                calibrated = CalibratedClassifierCV(base, method=cfg.calibration_method)
            else:
                # Older sklearn supported cv="prefit" directly.
                calibrated = CalibratedClassifierCV(
                    estimator=est, method=cfg.calibration_method, cv="prefit"
                )
            calibrated.fit(X_val.values, y_val.values.astype(int))
            return calibrated
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning("Calibration failed (%s); returning uncalibrated model.", exc)
    return est


def predict_proba(model, X: pd.DataFrame) -> np.ndarray:
    """Return P(y=1) as a 1-D float array."""
    proba = model.predict_proba(X.values)
    if proba.ndim != 2 or proba.shape[1] < 2:
        raise RuntimeError(f"predict_proba returned unexpected shape {proba.shape}")
    return proba[:, 1].astype(float)

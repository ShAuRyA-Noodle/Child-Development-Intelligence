"""
ECD Risk Engine — ML Scoring Engine (Phase 2)
XGBoost model loading, prediction, SHAP explanations, and hybrid scoring.
Falls back gracefully to None when no model file is available.
"""

import os
import logging
from typing import Optional

import numpy as np

from app.models.schemas import RiskScoreOutput, ContributingDomain

logger = logging.getLogger(__name__)

# Global model state
_model = None
_explainer = None


def load_model(path: str) -> bool:
    """
    Load an XGBoost model from the given file path.
    Returns True if loaded successfully, False otherwise.
    """
    global _model, _explainer

    if not os.path.exists(path):
        logger.warning(f"Model file not found at {path}. ML engine will be inactive.")
        _model = None
        _explainer = None
        return False

    try:
        import xgboost as xgb

        _model = xgb.Booster()
        _model.load_model(path)
        logger.info(f"ML model loaded from {path}")

        # SHAP is optional — load if available
        try:
            import shap
            _explainer = shap.TreeExplainer(_model)
            logger.info("SHAP explainer initialized.")
        except ImportError:
            _explainer = None
            logger.info("SHAP not available. Predictions will work without explanations.")

        return True
    except Exception as e:
        logger.error(f"Failed to load ML model from {path}: {e}")
        _model = None
        _explainer = None
        return False


def is_model_loaded() -> bool:
    """Check if the ML model is currently loaded."""
    return _model is not None


FEATURE_KEYS = [
    "gm_delay", "fm_delay", "lc_delay", "cog_delay", "se_delay",
    "num_delays",
    "gm_dq", "fm_dq", "lc_dq", "cog_dq", "se_dq", "composite_dq",
    "nutrition_score",
    "behaviour_score",
    "parent_child_interaction_score",
    "parent_mental_health_score",
    "home_stimulation_score",
    "autism_risk", "adhd_risk", "behavior_risk",
    "caregiver_engagement", "language_exposure",
    "play_materials", "safe_water",
]

# Categorical encodings (must match training)
_CAT_ENCODINGS = {
    "autism_risk": {"Low": 0, "Moderate": 1, "High": 2},
    "adhd_risk": {"Low": 0, "Moderate": 1, "High": 2},
    "behavior_risk": {"Low": 0, "Moderate": 1, "High": 2},
    "caregiver_engagement": {"High": 0, "Medium": 1, "Low": 2},
    "language_exposure": {"Adequate": 0, "Inadequate": 1},
    "play_materials": {"Yes": 0, "No": 1},
    "safe_water": {"Yes": 0, "No": 1},
}


def _extract_features(features: dict) -> np.ndarray:
    """Extract a feature vector from a dict of child assessment fields."""
    values = []
    for k in FEATURE_KEYS:
        val = features.get(k, 0)
        if k in _CAT_ENCODINGS:
            val = _CAT_ENCODINGS[k].get(str(val), 0)
        values.append(float(val) if val is not None else 0.0)
    return np.array([values])


def predict(features: dict) -> Optional[tuple[str, float]]:
    """
    Predict referral probability using the loaded XGBoost model.
    Returns (category, probability) or None if no model is loaded.
    Model is binary: probability of referral needed (positive class).
    """
    if _model is None:
        return None

    try:
        import xgboost as xgb

        X = _extract_features(features)
        dmatrix = xgb.DMatrix(X, feature_names=FEATURE_KEYS)
        prob_positive = float(_model.predict(dmatrix)[0])

        # Map probability to category
        if prob_positive >= 0.5:
            category = "High"
        elif prob_positive >= 0.25:
            category = "Medium"
        else:
            category = "Low"

        return category, prob_positive
    except Exception as e:
        logger.error(f"ML prediction failed: {e}")
        return None


def get_shap_values(features: dict) -> Optional[dict]:
    """
    Compute SHAP feature importance explanations for a prediction.
    Returns a dict mapping feature names to SHAP values, or None if unavailable.
    """
    if _explainer is None:
        return None

    try:
        X = _extract_features(features)
        shap_values = _explainer.shap_values(X)

        feature_keys = [
            "gm_delay", "fm_delay", "lc_delay", "cog_delay", "se_delay",
            "gm_dq", "fm_dq", "lc_dq", "cog_dq", "se_dq", "composite_dq",
            "nutrition_score", "behaviour_score",
            "parent_child_interaction_score", "home_stimulation_score",
        ]

        # For multi-class, shap_values is a list of arrays per class
        if isinstance(shap_values, list):
            # Use the SHAP values for the predicted class
            predicted_class = int(np.argmax(_model.predict_proba(X)[0]))
            values = shap_values[predicted_class][0]
        else:
            values = shap_values[0]

        return {k: round(float(v), 4) for k, v in zip(feature_keys, values)}
    except Exception as e:
        logger.error(f"SHAP computation failed: {e}")
        return None


def compute_hybrid_score(
    rule_score: RiskScoreOutput,
    ml_result: Optional[tuple[str, float]],
    alpha: float = 0.7,
) -> RiskScoreOutput:
    """
    Blend rule-based and ML scores.
    alpha controls the weight of the rule-based score (0.7 = 70% rule, 30% ML).
    If ML result is None, returns the rule score unchanged.
    """
    if ml_result is None:
        return rule_score

    ml_category, ml_probability = ml_result

    # Map categories to numeric for blending
    category_to_num = {"Low": 0, "Medium": 1, "High": 2}
    num_to_category = {0: "Low", 1: "Medium", 2: "High"}

    rule_num = category_to_num.get(rule_score.risk_category, 1)
    ml_num = category_to_num.get(ml_category, 1)

    # Weighted blend
    blended = alpha * rule_num + (1 - alpha) * ml_num
    blended_category = num_to_category[round(blended)]

    # Blend confidence
    blended_confidence = min(
        98,
        round(alpha * rule_score.confidence + (1 - alpha) * (ml_probability * 100), 1),
    )

    return RiskScoreOutput(
        child_id=rule_score.child_id,
        risk_score=rule_score.risk_score,
        risk_category=blended_category,
        confidence=blended_confidence,
        contributing_domains=rule_score.contributing_domains,
        composite_dq=rule_score.composite_dq,
        composite_dq_zscore=rule_score.composite_dq_zscore,
    )

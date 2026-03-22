"""
ECD Risk Engine — DEIC Ground Truth Linkage Pipeline

Links AWW screening predictions to clinical diagnoses from District Early
Intervention Centres (DEICs). This enables validation of the risk engine
against gold-standard clinical assessments.

Pipeline:
  1. Match referral records to DEIC clinical diagnoses by child_id.
  2. Compute binary and multi-class classification metrics.
  3. Generate calibration curves for predicted risk confidence.

No sklearn dependency — all metrics computed from scratch.
"""

from __future__ import annotations

import math
from collections import defaultdict
from datetime import date
from typing import Optional

from pydantic import BaseModel, Field


# ── Pydantic Models ──────────────────────────────────────────────────────────


class DEICReferral(BaseModel):
    """A referral record generated when the risk engine flags a child."""
    child_id: str = Field(..., description="Unique child identifier")
    referral_date: date = Field(..., description="Date the referral was issued")
    referred_by: str = Field(..., description="AWW or supervisor ID who made the referral")
    risk_category_at_referral: str = Field(
        ...,
        description="Risk category at time of referral: Low / Medium / High",
    )
    risk_score_at_referral: float = Field(
        ...,
        ge=0,
        description="Numeric risk score at time of referral",
    )


class DEICDiagnosis(BaseModel):
    """Clinical diagnosis record from a DEIC evaluation."""
    child_id: str = Field(..., description="Unique child identifier")
    diagnosis_date: date = Field(..., description="Date of clinical evaluation")
    clinician_id: str = Field(..., description="DEIC clinician identifier")
    confirmed_delays: list[str] = Field(
        default_factory=list,
        description="Developmental domains with confirmed delays (e.g., 'Gross Motor', 'Language')",
    )
    clinical_dq: float = Field(
        ...,
        ge=0,
        description="Clinically measured Developmental Quotient",
    )
    clinical_category: str = Field(
        ...,
        description="Clinical classification: Typical / At-Risk / Delayed / Severely Delayed",
    )
    diagnoses: list[str] = Field(
        default_factory=list,
        description="Specific clinical diagnoses (e.g., 'GDD', 'ASD', 'Speech delay')",
    )


class LinkageRecord(BaseModel):
    """Merged record linking a screening prediction to its clinical ground truth."""
    child_id: str = Field(..., description="Unique child identifier")
    referral_date: date = Field(..., description="Date of AWW referral")
    diagnosis_date: Optional[date] = Field(None, description="Date of DEIC evaluation")
    days_to_diagnosis: Optional[int] = Field(
        None,
        description="Days between referral and clinical evaluation",
    )
    predicted_category: str = Field(
        ...,
        description="Risk category from screening: Low / Medium / High",
    )
    predicted_score: float = Field(..., description="Numeric risk score from screening")
    clinical_category: Optional[str] = Field(
        None,
        description="Clinical classification: Typical / At-Risk / Delayed / Severely Delayed",
    )
    clinical_dq: Optional[float] = Field(None, description="Clinical DQ score")
    confirmed_delays: list[str] = Field(default_factory=list)
    diagnoses: list[str] = Field(default_factory=list)
    is_true_positive: Optional[bool] = Field(
        None,
        description="True if screening flagged High and clinical confirmed delay",
    )
    agreement: Optional[bool] = Field(
        None,
        description="True if predicted and clinical categories agree on binary risk",
    )


class PerClassMetrics(BaseModel):
    """Precision, recall, and F1 for a single class."""
    class_label: str
    precision: float
    recall: float
    f1: float
    support: int = Field(..., description="Number of ground-truth samples in this class")


class ValidationMetrics(BaseModel):
    """Comprehensive validation metrics comparing screening to clinical ground truth."""

    # Binary classification (High-risk vs not)
    sensitivity: float = Field(..., description="True positive rate (recall for High-risk)")
    specificity: float = Field(..., description="True negative rate")
    ppv: float = Field(..., description="Positive predictive value (precision for High-risk)")
    npv: float = Field(..., description="Negative predictive value")

    # Multi-class (Low / Medium / High)
    confusion_matrix: dict[str, dict[str, int]] = Field(
        ...,
        description="Nested dict: confusion_matrix[actual][predicted] = count",
    )
    per_class: list[PerClassMetrics] = Field(
        ...,
        description="Per-class precision, recall, F1",
    )
    weighted_f1: float = Field(..., description="Support-weighted macro F1")

    # Agreement
    cohens_kappa: float = Field(..., description="Cohen's kappa for inter-rater agreement")

    # Summary
    n_linked: int = Field(..., description="Total linked records used for validation")
    n_unmatched_referrals: int = Field(
        0,
        description="Referrals without a matching DEIC diagnosis",
    )


# ── Linkage Function ─────────────────────────────────────────────────────────


def link_predictions_to_diagnoses(
    referrals: list[DEICReferral],
    diagnoses: list[DEICDiagnosis],
) -> list[LinkageRecord]:
    """
    Match screening referrals to DEIC clinical diagnoses by child_id.

    Each referral is linked to the earliest diagnosis for the same child that
    occurs on or after the referral date. If no matching diagnosis exists, the
    linkage record is created with clinical fields set to None.

    Args:
        referrals: List of referral records from the risk engine.
        diagnoses: List of clinical diagnosis records from DEICs.

    Returns:
        List of LinkageRecord instances, one per referral.
    """
    # Index diagnoses by child_id, sorted by date ascending
    dx_by_child: dict[str, list[DEICDiagnosis]] = defaultdict(list)
    for dx in diagnoses:
        dx_by_child[dx.child_id].append(dx)
    for child_id in dx_by_child:
        dx_by_child[child_id].sort(key=lambda d: d.diagnosis_date)

    linked: list[LinkageRecord] = []

    for ref in referrals:
        # Find the earliest diagnosis on or after the referral date
        matched_dx: Optional[DEICDiagnosis] = None
        for dx in dx_by_child.get(ref.child_id, []):
            if dx.diagnosis_date >= ref.referral_date:
                matched_dx = dx
                break

        if matched_dx is not None:
            days_gap = (matched_dx.diagnosis_date - ref.referral_date).days
            clinical_is_delayed = matched_dx.clinical_category in (
                "Delayed", "Severely Delayed",
            )
            predicted_high = ref.risk_category_at_referral == "High"
            is_tp = predicted_high and clinical_is_delayed
            agrees = _binary_agree(
                ref.risk_category_at_referral,
                matched_dx.clinical_category,
            )

            linked.append(LinkageRecord(
                child_id=ref.child_id,
                referral_date=ref.referral_date,
                diagnosis_date=matched_dx.diagnosis_date,
                days_to_diagnosis=days_gap,
                predicted_category=ref.risk_category_at_referral,
                predicted_score=ref.risk_score_at_referral,
                clinical_category=matched_dx.clinical_category,
                clinical_dq=matched_dx.clinical_dq,
                confirmed_delays=matched_dx.confirmed_delays,
                diagnoses=matched_dx.diagnoses,
                is_true_positive=is_tp,
                agreement=agrees,
            ))
        else:
            linked.append(LinkageRecord(
                child_id=ref.child_id,
                referral_date=ref.referral_date,
                predicted_category=ref.risk_category_at_referral,
                predicted_score=ref.risk_score_at_referral,
            ))

    return linked


def _binary_agree(predicted_cat: str, clinical_cat: str) -> bool:
    """
    Check if screening and clinical classification agree on a binary basis.

    Mapping:
        Screening High   <-> Clinical Delayed / Severely Delayed  (positive)
        Screening Low/Med <-> Clinical Typical / At-Risk           (negative)
    """
    pred_positive = predicted_cat == "High"
    clin_positive = clinical_cat in ("Delayed", "Severely Delayed")
    return pred_positive == clin_positive


# ── Validation Metrics ────────────────────────────────────────────────────────


# Map clinical categories to the 3-class scheme used by the screening tool.
_CLINICAL_TO_RISK = {
    "Typical": "Low",
    "At-Risk": "Medium",
    "Delayed": "High",
    "Severely Delayed": "High",
}

_RISK_CLASSES = ["Low", "Medium", "High"]


def compute_validation_metrics(
    linked_records: list[LinkageRecord],
) -> ValidationMetrics:
    """
    Compute classification metrics comparing screening predictions to
    clinical ground truth.

    Only records with a matched clinical diagnosis are used. Records
    without a diagnosis are counted as unmatched referrals.

    Args:
        linked_records: Output from link_predictions_to_diagnoses().

    Returns:
        ValidationMetrics with binary and multi-class statistics.
    """
    matched = [r for r in linked_records if r.clinical_category is not None]
    n_unmatched = len(linked_records) - len(matched)

    if not matched:
        return ValidationMetrics(
            sensitivity=0.0,
            specificity=0.0,
            ppv=0.0,
            npv=0.0,
            confusion_matrix={c: {c2: 0 for c2 in _RISK_CLASSES} for c in _RISK_CLASSES},
            per_class=[
                PerClassMetrics(class_label=c, precision=0.0, recall=0.0, f1=0.0, support=0)
                for c in _RISK_CLASSES
            ],
            weighted_f1=0.0,
            cohens_kappa=0.0,
            n_linked=0,
            n_unmatched_referrals=n_unmatched,
        )

    # ── Binary metrics (High vs not-High) ────────────────────────────────
    tp = fp = tn = fn = 0
    for r in matched:
        pred_pos = r.predicted_category == "High"
        clin_pos = r.clinical_category in ("Delayed", "Severely Delayed")
        if pred_pos and clin_pos:
            tp += 1
        elif pred_pos and not clin_pos:
            fp += 1
        elif not pred_pos and clin_pos:
            fn += 1
        else:
            tn += 1

    sensitivity = _safe_div(tp, tp + fn)
    specificity = _safe_div(tn, tn + fp)
    ppv = _safe_div(tp, tp + fp)
    npv = _safe_div(tn, tn + fn)

    # ── Multi-class confusion matrix ─────────────────────────────────────
    cm: dict[str, dict[str, int]] = {
        actual: {pred: 0 for pred in _RISK_CLASSES}
        for actual in _RISK_CLASSES
    }
    for r in matched:
        actual = _CLINICAL_TO_RISK.get(r.clinical_category, "Medium")
        pred = r.predicted_category if r.predicted_category in _RISK_CLASSES else "Medium"
        cm[actual][pred] += 1

    # ── Per-class precision / recall / F1 ────────────────────────────────
    per_class_metrics: list[PerClassMetrics] = []
    total_support = len(matched)

    for cls in _RISK_CLASSES:
        # True positives for this class
        cls_tp = cm[cls][cls]
        # False positives: predicted as cls but actually another class
        cls_fp = sum(cm[other][cls] for other in _RISK_CLASSES if other != cls)
        # False negatives: actually cls but predicted as another class
        cls_fn = sum(cm[cls][other] for other in _RISK_CLASSES if other != cls)
        support = sum(cm[cls].values())

        prec = _safe_div(cls_tp, cls_tp + cls_fp)
        rec = _safe_div(cls_tp, cls_tp + cls_fn)
        f1 = _safe_div(2 * prec * rec, prec + rec)

        per_class_metrics.append(PerClassMetrics(
            class_label=cls,
            precision=round(prec, 4),
            recall=round(rec, 4),
            f1=round(f1, 4),
            support=support,
        ))

    # Weighted F1
    weighted_f1 = sum(
        m.f1 * m.support / total_support for m in per_class_metrics
    ) if total_support > 0 else 0.0

    # ── Cohen's kappa ────────────────────────────────────────────────────
    kappa = _cohens_kappa(cm, _RISK_CLASSES, total_support)

    return ValidationMetrics(
        sensitivity=round(sensitivity, 4),
        specificity=round(specificity, 4),
        ppv=round(ppv, 4),
        npv=round(npv, 4),
        confusion_matrix=cm,
        per_class=per_class_metrics,
        weighted_f1=round(weighted_f1, 4),
        cohens_kappa=round(kappa, 4),
        n_linked=len(matched),
        n_unmatched_referrals=n_unmatched,
    )


def _safe_div(numerator: float, denominator: float) -> float:
    """Division that returns 0.0 when the denominator is zero."""
    return numerator / denominator if denominator != 0 else 0.0


def _cohens_kappa(
    cm: dict[str, dict[str, int]],
    classes: list[str],
    n: int,
) -> float:
    """
    Compute Cohen's kappa from a confusion matrix.

    kappa = (p_o - p_e) / (1 - p_e)

    where p_o is observed agreement and p_e is expected agreement by chance.
    """
    if n == 0:
        return 0.0

    # Observed agreement: sum of diagonal / total
    p_o = sum(cm[c][c] for c in classes) / n

    # Expected agreement: for each class, (row_total * col_total) / n^2
    p_e = 0.0
    for c in classes:
        row_total = sum(cm[c].values())
        col_total = sum(cm[other][c] for other in classes)
        p_e += (row_total * col_total) / (n * n)

    if p_e == 1.0:
        return 1.0 if p_o == 1.0 else 0.0

    return (p_o - p_e) / (1 - p_e)


# ── Calibration Curve ─────────────────────────────────────────────────────────


def compute_calibration_curve(
    linked_records: list[LinkageRecord],
    n_bins: int = 10,
) -> dict:
    """
    Compute a calibration curve for the risk engine's confidence scores.

    Groups linked records into bins by predicted risk score percentile and
    computes the observed positive rate (clinical delay confirmed) in each bin.
    A well-calibrated model will have observed rates that track the predicted
    confidence within each bin.

    Args:
        linked_records: Output from link_predictions_to_diagnoses().
        n_bins: Number of bins to divide the score range into (default 10).

    Returns:
        A dict with:
          - bins: list of dicts, each containing:
              - bin_index: 0-based bin number
              - score_range_low: lower bound of scores in this bin
              - score_range_high: upper bound of scores in this bin
              - mean_predicted_score: average predicted risk score in the bin
              - observed_positive_rate: fraction with confirmed clinical delay
              - count: number of records in the bin
          - n_total: total matched records used
          - n_bins_actual: number of non-empty bins returned
    """
    matched = [
        r for r in linked_records
        if r.clinical_category is not None
    ]

    if not matched:
        return {"bins": [], "n_total": 0, "n_bins_actual": 0}

    # Sort by predicted score
    matched.sort(key=lambda r: r.predicted_score)

    scores = [r.predicted_score for r in matched]
    score_min = scores[0]
    score_max = scores[-1]

    # Handle edge case: all scores identical
    if score_max == score_min:
        pos_count = sum(
            1 for r in matched
            if r.clinical_category in ("Delayed", "Severely Delayed")
        )
        obs_rate = pos_count / len(matched)
        return {
            "bins": [{
                "bin_index": 0,
                "score_range_low": round(score_min, 4),
                "score_range_high": round(score_max, 4),
                "mean_predicted_score": round(score_min, 4),
                "observed_positive_rate": round(obs_rate, 4),
                "count": len(matched),
            }],
            "n_total": len(matched),
            "n_bins_actual": 1,
        }

    bin_width = (score_max - score_min) / n_bins
    bins_data: list[dict] = []

    for i in range(n_bins):
        low = score_min + i * bin_width
        high = score_min + (i + 1) * bin_width

        # Include the upper boundary in the last bin
        if i == n_bins - 1:
            bin_records = [
                r for r in matched
                if low <= r.predicted_score <= high
            ]
        else:
            bin_records = [
                r for r in matched
                if low <= r.predicted_score < high
            ]

        if not bin_records:
            continue

        mean_score = sum(r.predicted_score for r in bin_records) / len(bin_records)
        pos_count = sum(
            1 for r in bin_records
            if r.clinical_category in ("Delayed", "Severely Delayed")
        )
        obs_rate = pos_count / len(bin_records)

        bins_data.append({
            "bin_index": i,
            "score_range_low": round(low, 4),
            "score_range_high": round(high, 4),
            "mean_predicted_score": round(mean_score, 4),
            "observed_positive_rate": round(obs_rate, 4),
            "count": len(bin_records),
        })

    return {
        "bins": bins_data,
        "n_total": len(matched),
        "n_bins_actual": len(bins_data),
    }

"""
ECD Risk Engine — Early Warning Detection
Detects stagnation, regression, and anomalies from longitudinal assessment data.
"""

import math
from typing import Optional

from app.models.schemas import (
    ChildAssessmentInput,
    AlertOutput,
    EarlyWarningInput,
    EarlyWarningOutput,
)

_warning_counter = 0


def _next_warning_id() -> str:
    global _warning_counter
    _warning_counter += 1
    return f"EW_{_warning_counter:05d}"


def detect_stagnation(
    current: ChildAssessmentInput,
    previous_assessments: list[ChildAssessmentInput],
) -> list[AlertOutput]:
    """
    Detect developmental stagnation.
    If composite_dq change < 2.0 over >= 3 assessments (proxy for months),
    emit a moderate alert.
    """
    warnings: list[AlertOutput] = []

    if len(previous_assessments) < 3:
        return warnings

    # Compare current to the oldest of the last 3 assessments
    oldest = previous_assessments[0]
    dq_change = current.composite_dq - oldest.composite_dq

    if abs(dq_change) < 2.0 and current.composite_dq > 0:
        warnings.append(AlertOutput(
            alert_id=_next_warning_id(),
            child_id=current.child_id,
            domain="Multi-domain",
            indicator="Developmental Stagnation",
            severity="moderate",
            confidence=85.0,
            dq_value=current.composite_dq,
            message=(
                f"Composite DQ stagnant at {current.composite_dq:.0f} "
                f"(change: {dq_change:+.1f} over {len(previous_assessments)} assessments)"
            ),
            suggested_action="Review intervention plan effectiveness; consider specialist consultation",
        ))

    return warnings


def detect_regression(
    current: ChildAssessmentInput,
    previous: ChildAssessmentInput,
) -> list[AlertOutput]:
    """
    Detect developmental regression.
    - Composite DQ drop > 5.0 -> critical alert
    - Per-domain DQ drop > 10.0 -> high alert
    """
    warnings: list[AlertOutput] = []

    # Composite regression
    composite_change = current.composite_dq - previous.composite_dq
    if composite_change < -5.0:
        warnings.append(AlertOutput(
            alert_id=_next_warning_id(),
            child_id=current.child_id,
            domain="Multi-domain",
            indicator="Developmental Regression",
            severity="critical",
            confidence=93.0,
            dq_value=current.composite_dq,
            message=(
                f"Composite DQ dropped from {previous.composite_dq:.0f} to "
                f"{current.composite_dq:.0f} (change: {composite_change:+.1f})"
            ),
            suggested_action="Urgent specialist referral; investigate cause of regression; intensify intervention",
        ))

    # Per-domain regression
    domain_pairs = [
        ("gm_dq", "Gross Motor"),
        ("fm_dq", "Fine Motor"),
        ("lc_dq", "Language/Communication"),
        ("cog_dq", "Cognitive"),
        ("se_dq", "Socio-Emotional"),
    ]

    for field, label in domain_pairs:
        current_val = getattr(current, field)
        previous_val = getattr(previous, field)
        change = current_val - previous_val

        if change < -10.0 and current_val > 0:
            warnings.append(AlertOutput(
                alert_id=_next_warning_id(),
                child_id=current.child_id,
                domain=label,
                indicator=f"{label} Regression",
                severity="high",
                confidence=90.0,
                dq_value=current_val,
                message=(
                    f"{label} DQ dropped from {previous_val:.0f} to "
                    f"{current_val:.0f} (change: {change:+.1f})"
                ),
                suggested_action=f"Review {label.lower()} intervention; consider domain-specific specialist referral",
            ))

    return warnings


def detect_anomaly(
    current: ChildAssessmentInput,
    population_stats: Optional[dict] = None,
) -> list[AlertOutput]:
    """
    Detect statistical anomalies in assessment scores.
    If |z-score| > 2.5 for any domain DQ, emit a high alert.

    population_stats should be a dict like:
    {
        "gm_dq": {"mean": 80.0, "std": 15.0},
        "fm_dq": {"mean": 82.0, "std": 14.0},
        ...
    }

    If population_stats is None, uses hardcoded population defaults.
    """
    warnings: list[AlertOutput] = []

    # Default population stats (representative values)
    defaults = {
        "gm_dq": {"mean": 82.0, "std": 15.0},
        "fm_dq": {"mean": 83.0, "std": 14.0},
        "lc_dq": {"mean": 80.0, "std": 16.0},
        "cog_dq": {"mean": 81.0, "std": 15.0},
        "se_dq": {"mean": 84.0, "std": 13.0},
        "composite_dq": {"mean": 82.0, "std": 14.0},
    }

    stats = population_stats or defaults

    domain_labels = {
        "gm_dq": "Gross Motor",
        "fm_dq": "Fine Motor",
        "lc_dq": "Language/Communication",
        "cog_dq": "Cognitive",
        "se_dq": "Socio-Emotional",
        "composite_dq": "Composite",
    }

    for field, label in domain_labels.items():
        value = getattr(current, field, 0.0)
        if value <= 0:
            continue

        field_stats = stats.get(field)
        if not field_stats:
            continue

        mean = field_stats["mean"]
        std = field_stats["std"]
        if std <= 0:
            continue

        zscore = (value - mean) / std

        if abs(zscore) > 2.5:
            direction = "below" if zscore < 0 else "above"
            warnings.append(AlertOutput(
                alert_id=_next_warning_id(),
                child_id=current.child_id,
                domain=label,
                indicator=f"{label} Statistical Anomaly",
                severity="high",
                confidence=88.0,
                dq_value=value,
                message=(
                    f"{label} DQ={value:.0f} is {abs(zscore):.1f} std devs "
                    f"{direction} mean ({mean:.0f})"
                ),
                suggested_action=f"Verify {label.lower()} assessment accuracy; flag for clinical review",
            ))

    return warnings


def generate_early_warnings(input_data: EarlyWarningInput) -> EarlyWarningOutput:
    """
    Generate all early warnings for a child based on current and previous assessments.
    """
    all_warnings: list[AlertOutput] = []

    # Stagnation detection (needs >= 3 previous assessments)
    stagnation_warnings = detect_stagnation(
        input_data.current_assessment,
        input_data.previous_assessments,
    )
    all_warnings.extend(stagnation_warnings)

    # Regression detection (compare against most recent previous)
    if input_data.previous_assessments:
        most_recent = input_data.previous_assessments[-1]
        regression_warnings = detect_regression(
            input_data.current_assessment,
            most_recent,
        )
        all_warnings.extend(regression_warnings)

    # Anomaly detection (against population defaults)
    anomaly_warnings = detect_anomaly(input_data.current_assessment)
    all_warnings.extend(anomaly_warnings)

    return EarlyWarningOutput(
        child_id=input_data.child_id,
        warnings=all_warnings,
    )

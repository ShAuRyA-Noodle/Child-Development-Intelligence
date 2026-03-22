"""
ECD Risk Engine — Bias Audit Service
Checks scoring fairness across demographic subgroups.

Computes disparate impact ratios and flags groups where the risk engine
may be systematically over- or under-scoring relative to others.

Reference: Feldman et al. (2015) "Certifying and Removing Disparate Impact"
           80% rule (4/5ths rule) from US EEOC Uniform Guidelines
"""

from __future__ import annotations
from collections import defaultdict
from typing import Optional
from pydantic import BaseModel, Field

from app.models.schemas import ChildAssessmentInput, RiskScoreOutput
from app.services.rule_engine import compute_risk_score


# ── Equity demographic fields ──
# These fields are attached to child records for fairness analysis.
# They are NEVER used as inputs to the risk scoring algorithm.
EQUITY_FIELDS = [
    "gender",           # M / F / O
    "caste_category",   # General / OBC / SC / ST
    "religion",         # Hindu / Muslim / Christian / Sikh / Buddhist / Other
    "area_type",        # Urban / Rural / Tribal
    "mother_education", # None / Primary / Secondary / Higher
    "economic_category", # APL / BPL / AAY (Antyodaya Anna Yojana)
]


class SubgroupStats(BaseModel):
    """Statistics for a single demographic subgroup."""
    group_field: str
    group_value: str
    n: int
    mean_score: float
    high_risk_rate: float
    medium_risk_rate: float
    low_risk_rate: float


class DisparateImpactResult(BaseModel):
    """Disparate impact analysis for one demographic axis."""
    field: str
    reference_group: str
    reference_high_rate: float
    subgroups: list[SubgroupStats]
    flagged_groups: list[str] = Field(
        default_factory=list,
        description="Groups with disparate impact ratio < 0.8 or > 1.25",
    )
    min_ratio: Optional[float] = None
    max_ratio: Optional[float] = None
    passes_four_fifths: bool = True


class BiasAuditResult(BaseModel):
    """Complete bias audit result across all demographic axes."""
    total_children: int
    axes_analyzed: list[DisparateImpactResult]
    overall_pass: bool
    summary: str


def run_bias_audit(
    children: list[dict],
    equity_data: dict[str, dict[str, str]],
) -> BiasAuditResult:
    """
    Run a bias audit on a batch of scored children.

    Args:
        children: List of child assessment dicts (ChildAssessmentInput-compatible)
        equity_data: Mapping of child_id → {equity_field: value}
                     e.g., {"AP_ECD_001": {"gender": "F", "caste_category": "SC", ...}}

    Returns:
        BiasAuditResult with disparate impact analysis per demographic axis.
    """
    # Score all children
    scored: list[tuple[dict, RiskScoreOutput]] = []
    for child_dict in children:
        child = ChildAssessmentInput(**child_dict)
        result = compute_risk_score(child)
        scored.append((child_dict, result))

    if not scored:
        return BiasAuditResult(
            total_children=0,
            axes_analyzed=[],
            overall_pass=True,
            summary="No children to audit.",
        )

    # Analyze each equity field
    axes: list[DisparateImpactResult] = []
    overall_pass = True

    for field in EQUITY_FIELDS:
        # Group children by this field's value
        groups: dict[str, list[RiskScoreOutput]] = defaultdict(list)
        for child_dict, result in scored:
            child_id = child_dict.get("child_id", "")
            eq = equity_data.get(child_id, {})
            value = eq.get(field)
            if value:
                groups[value].append(result)

        if len(groups) < 2:
            continue  # Need at least 2 groups to compare

        # Compute stats per group
        subgroup_stats: list[SubgroupStats] = []
        for value, results in groups.items():
            n = len(results)
            if n == 0:
                continue
            high_count = sum(1 for r in results if r.risk_category == "High")
            med_count = sum(1 for r in results if r.risk_category == "Medium")
            low_count = sum(1 for r in results if r.risk_category == "Low")
            mean_score = sum(r.risk_score for r in results) / n

            subgroup_stats.append(SubgroupStats(
                group_field=field,
                group_value=value,
                n=n,
                mean_score=round(mean_score, 2),
                high_risk_rate=round(high_count / n, 4),
                medium_risk_rate=round(med_count / n, 4),
                low_risk_rate=round(low_count / n, 4),
            ))

        if not subgroup_stats:
            continue

        # Reference group = largest group (most representative)
        ref = max(subgroup_stats, key=lambda s: s.n)
        ref_high_rate = ref.high_risk_rate

        # Compute disparate impact ratios
        flagged: list[str] = []
        ratios: list[float] = []

        for sg in subgroup_stats:
            if sg.group_value == ref.group_value:
                continue
            if ref_high_rate > 0:
                ratio = sg.high_risk_rate / ref_high_rate
            elif sg.high_risk_rate > 0:
                ratio = float("inf")
            else:
                ratio = 1.0

            ratios.append(ratio)

            # 4/5ths rule: ratio < 0.8 = underdetection, > 1.25 = overdetection
            if ratio < 0.8 or ratio > 1.25:
                flagged.append(sg.group_value)

        passes = len(flagged) == 0

        axes.append(DisparateImpactResult(
            field=field,
            reference_group=ref.group_value,
            reference_high_rate=ref_high_rate,
            subgroups=subgroup_stats,
            flagged_groups=flagged,
            min_ratio=round(min(ratios), 4) if ratios else None,
            max_ratio=round(max(ratios), 4) if ratios else None,
            passes_four_fifths=passes,
        ))

        if not passes:
            overall_pass = False

    # Summary
    flagged_axes = [a.field for a in axes if not a.passes_four_fifths]
    if flagged_axes:
        summary = (
            f"Bias detected in {len(flagged_axes)} axes: {', '.join(flagged_axes)}. "
            f"Review scoring weights for potential demographic confounding."
        )
    else:
        summary = f"All {len(axes)} demographic axes pass the 4/5ths rule. No disparate impact detected."

    return BiasAuditResult(
        total_children=len(scored),
        axes_analyzed=axes,
        overall_pass=overall_pass,
        summary=summary,
    )

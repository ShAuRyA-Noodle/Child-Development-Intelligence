"""
ECD Risk Engine — Rule-Based Scoring Engine
v2: Dual output (old_score + new_score) with regression-derived weights,
    reduced ADHD/behaviour weights, environmental risk factors,
    WHO z-score nutrition, and language exposure.
"""

from app.models.schemas import ChildAssessmentInput, RiskScoreOutput, ContributingDomain
from app.utils.constants import (
    DELAY_DOMAIN_POINTS,
    DELAY_DOMAIN_WEIGHTS,
    AUTISM_RISK_POINTS,
    ADHD_RISK_POINTS,
    ADHD_RISK_POINTS_V1,
    BEHAVIORAL_RISK_POINTS,
    BEHAVIORAL_RISK_POINTS_V1,
    RISK_THRESHOLDS,
    RISK_THRESHOLDS_V2,
    MAX_RISK_CONFIDENCE,
    COMPLETENESS_CORE_FIELDS,
    COMPLETENESS_SUPPLEMENTARY_FIELDS,
    CONF_BASE,
    CONF_CORE_WEIGHT,
    CONF_SUPP_WEIGHT,
    CONF_WHO_WEIGHT,
    CONF_AGREEMENT_WEIGHT,
    CONF_AGREEMENT_THRESHOLD,
    ENV_RISK_HOME_STIMULATION_THRESHOLD,
    ENV_RISK_HOME_STIMULATION_POINTS,
    ENV_RISK_PARENT_MENTAL_HEALTH_THRESHOLD,
    ENV_RISK_PARENT_MENTAL_HEALTH_POINTS,
    ENV_RISK_LOW_CAREGIVER_ENGAGEMENT_POINTS,
    ENV_RISK_INADEQUATE_LANGUAGE_EXPOSURE_POINTS,
)


DELAY_LABELS: dict[str, str] = {
    "gm_delay": "Gross Motor",
    "fm_delay": "Fine Motor",
    "lc_delay": "Language/Communication",
    "cog_delay": "Cognitive",
    "se_delay": "Socio-Emotional",
}


def _categorize(score: int, thresholds: dict[str, int]) -> str:
    if score <= thresholds["Low"]:
        return "Low"
    elif score <= thresholds["Medium"]:
        return "Medium"
    return "High"


def _apply_overrides(category: str, child: ChildAssessmentInput, is_v2: bool = False, waz: float | None = None) -> str:
    """Override rules applied to scores."""
    if child.autism_risk == "High" and category == "Low":
        category = "Medium"
    if child.num_delays >= 3 and category == "Low":
        category = "Medium"
    if child.composite_dq > 0 and child.composite_dq < 60:
        category = "High"
    # v2: WAZ < -3.0 → minimum Medium
    if is_v2 and waz is not None and waz < -3.0 and category == "Low":
        category = "Medium"
    return category


def compute_risk_score(child: ChildAssessmentInput) -> RiskScoreOutput:
    """
    Compute dual risk scores:
      old_score / old_category — legacy flat 5-pt weights, old ADHD/beh weights, old thresholds
      risk_score / risk_category — v2 regression weights + env factors + WHO nutrition, new thresholds
    """
    old_score = 0
    new_score = 0
    contributing: list[ContributingDomain] = []

    # ── Developmental delays ──
    for field, label in DELAY_LABELS.items():
        if getattr(child, field) == 1:
            old_pts = DELAY_DOMAIN_POINTS
            new_pts = DELAY_DOMAIN_WEIGHTS[field]
            old_score += old_pts
            new_score += new_pts
            contributing.append(ContributingDomain(
                domain=label,
                points=new_pts,
                reason=f"Developmental delay detected (v2 weight: {new_pts})",
            ))

    # ── Autism risk (same for v1 and v2) ──
    autism_pts = AUTISM_RISK_POINTS.get(child.autism_risk, 0)
    if autism_pts > 0:
        old_score += autism_pts
        new_score += autism_pts
        contributing.append(ContributingDomain(
            domain="Autism Risk",
            points=autism_pts,
            reason=f"Autism risk: {child.autism_risk}",
        ))

    # ── ADHD risk (v1 uses old weights, v2 uses reduced weights) ──
    adhd_pts_v1 = ADHD_RISK_POINTS_V1.get(child.adhd_risk, 0)
    adhd_pts_v2 = ADHD_RISK_POINTS.get(child.adhd_risk, 0)
    old_score += adhd_pts_v1
    if adhd_pts_v2 > 0:
        new_score += adhd_pts_v2
        contributing.append(ContributingDomain(
            domain="ADHD Risk",
            points=adhd_pts_v2,
            reason=f"ADHD risk: {child.adhd_risk}",
        ))

    # ── Behavioral risk (v1 uses old weights, v2 uses reduced) ──
    beh_pts_v1 = BEHAVIORAL_RISK_POINTS_V1.get(child.behavior_risk, 0)
    beh_pts_v2 = BEHAVIORAL_RISK_POINTS.get(child.behavior_risk, 0)
    old_score += beh_pts_v1
    if beh_pts_v2 > 0:
        new_score += beh_pts_v2
        contributing.append(ContributingDomain(
            domain="Behavioral",
            points=beh_pts_v2,
            reason=f"Behavior risk: {child.behavior_risk}",
        ))

    # ── Nutrition (old scoring uses integer threshold) ──
    if child.nutrition_score >= 4:
        old_score += 3

    # ── v2 environmental risk factors (new_score only) ──
    if child.home_stimulation_score <= ENV_RISK_HOME_STIMULATION_THRESHOLD:
        pts = ENV_RISK_HOME_STIMULATION_POINTS
        new_score += pts
        contributing.append(ContributingDomain(
            domain="Home Environment",
            points=pts,
            reason=f"Low home stimulation score: {child.home_stimulation_score}",
        ))

    if child.parent_mental_health_score <= ENV_RISK_PARENT_MENTAL_HEALTH_THRESHOLD:
        pts = ENV_RISK_PARENT_MENTAL_HEALTH_POINTS
        new_score += pts
        contributing.append(ContributingDomain(
            domain="Parent Mental Health",
            points=pts,
            reason=f"Low parent mental health score: {child.parent_mental_health_score}",
        ))

    if child.caregiver_engagement == "Low":
        pts = ENV_RISK_LOW_CAREGIVER_ENGAGEMENT_POINTS
        new_score += pts
        contributing.append(ContributingDomain(
            domain="Caregiver Engagement",
            points=pts,
            reason="Low caregiver engagement",
        ))

    if getattr(child, "language_exposure", None) == "Inadequate":
        pts = ENV_RISK_INADEQUATE_LANGUAGE_EXPOSURE_POINTS
        new_score += pts
        contributing.append(ContributingDomain(
            domain="Language Exposure",
            points=pts,
            reason="Inadequate language exposure",
        ))

    # ── WHO z-score nutrition (computed here; replaces nutrition_score for v2) ──
    waz = None
    haz = None
    whz = None
    who_nutrition_risk = None

    if child.weight_kg is not None and child.height_cm is not None and child.gender_code:
        from app.services.who_zscore import compute_who_zscores
        zscores = compute_who_zscores(
            age_months=child.age_months,
            gender=child.gender_code,
            weight_kg=child.weight_kg,
            height_cm=child.height_cm,
            gestational_weeks=child.gestational_weeks,
        )
        waz = zscores["waz"]
        haz = zscores["haz"]
        whz = zscores["whz"]
        who_nutrition_risk = zscores["who_nutrition_risk"]

        # WHO-based nutrition points for v2
        if waz < -3.0:
            new_score += 5
            contributing.append(ContributingDomain(
                domain="WHO Nutrition", points=5,
                reason=f"Severely underweight (WAZ={waz:.2f})",
            ))
        elif waz < -2.0:
            new_score += 3
            contributing.append(ContributingDomain(
                domain="WHO Nutrition", points=3,
                reason=f"Underweight (WAZ={waz:.2f})",
            ))

        if whz < -2.0:
            new_score += 3
            contributing.append(ContributingDomain(
                domain="WHO Nutrition", points=3,
                reason=f"Wasted (WHZ={whz:.2f})",
            ))

        if haz < -2.0:
            new_score += 2
            contributing.append(ContributingDomain(
                domain="WHO Nutrition", points=2,
                reason=f"Stunted (HAZ={haz:.2f})",
            ))

        # MUAC check
        if child.muac_cm is not None and child.muac_cm < 11.5:
            new_score += 3
            contributing.append(ContributingDomain(
                domain="WHO Nutrition", points=3,
                reason=f"Acute malnutrition (MUAC={child.muac_cm}cm)",
            ))
    else:
        # Fallback: use old nutrition_score for v2 if no WHO data
        if child.nutrition_score >= 4:
            new_score += 3
            contributing.append(ContributingDomain(
                domain="Nutrition", points=3,
                reason=f"Nutrition score: {child.nutrition_score} (pre-WHO)",
            ))

    # ── Categorize ──
    old_category = _apply_overrides(
        _categorize(old_score, RISK_THRESHOLDS), child
    )
    new_category = _apply_overrides(
        _categorize(new_score, RISK_THRESHOLDS_V2), child, is_v2=True, waz=waz
    )

    # ── Calibrated confidence ──
    # 1. Core DQ completeness (5 domains)
    core_filled = sum(
        1 for f in COMPLETENESS_CORE_FIELDS
        if getattr(child, f, 0) != 0
    )
    core_ratio = core_filled / len(COMPLETENESS_CORE_FIELDS)

    # 2. Supplementary field completeness
    supp_filled = sum(
        1 for f in COMPLETENESS_SUPPLEMENTARY_FIELDS
        if getattr(child, f, 0) != 0
    )
    supp_ratio = supp_filled / len(COMPLETENESS_SUPPLEMENTARY_FIELDS)

    # 3. WHO anthropometric data present
    has_who = 1.0 if (waz is not None and haz is not None and whz is not None) else 0.0

    # 4. Cross-domain signal agreement — do the contributing domains
    #    consistently point toward the same risk category?
    #    High agreement = more confident in the result.
    if contributing:
        # Each contributing domain's points imply risk severity.
        # Agreement = fraction of domains whose implied severity matches the final category.
        def _domain_implies_high(pts: int) -> bool:
            return pts >= 5

        high_signals = sum(1 for d in contributing if _domain_implies_high(d.points))
        total_signals = len(contributing)

        if new_category == "High":
            agreement = high_signals / total_signals
        elif new_category == "Low":
            agreement = (total_signals - high_signals) / total_signals
        else:  # Medium
            agreement = 0.5  # Medium is inherently uncertain
    else:
        # No contributing domains = no data = low confidence
        agreement = 0.0

    # Combine weighted components → probability in [0, 1]
    raw_conf = (
        CONF_BASE
        + CONF_CORE_WEIGHT * core_ratio
        + CONF_SUPP_WEIGHT * supp_ratio
        + CONF_WHO_WEIGHT * has_who
        + CONF_AGREEMENT_WEIGHT * min(1.0, agreement / CONF_AGREEMENT_THRESHOLD)
    )

    # Scale to percentage and clamp
    confidence = min(MAX_RISK_CONFIDENCE, round(raw_conf * 100, 1))

    return RiskScoreOutput(
        child_id=child.child_id,
        risk_score=new_score,
        risk_category=new_category,
        old_score=old_score,
        old_category=old_category,
        confidence=confidence,
        contributing_domains=contributing,
        composite_dq=child.composite_dq,
        composite_dq_zscore=None,
        waz=waz,
        haz=haz,
        whz=whz,
        who_nutrition_risk=who_nutrition_risk,
    )

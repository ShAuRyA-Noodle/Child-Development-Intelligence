"""
ECD Risk Engine — Intervention Recommendation Mapper
Ported from scripts/process_data.py lines 424-534.
"""

from app.models.schemas import ChildAssessmentInput, InterventionPlanOutput
from app.utils.constants import (
    DQ_DELAY_THRESHOLD,
    DQ_CONCERN_THRESHOLD,
    MAX_INTERVENTION_ACTIVITIES,
)


def generate_intervention_plan(child: ChildAssessmentInput) -> list[InterventionPlanOutput]:
    """
    Generate intervention plans for a child based on DQ scores and risk levels.
    Exact same logic as process_data.py lines 429-534.
    Capped at MAX_INTERVENTION_ACTIVITIES, sorted by priority.
    """
    plans: list[InterventionPlanOutput] = []

    # Speech/Language intervention
    if child.lc_dq < DQ_CONCERN_THRESHOLD and child.lc_dq > 0:
        severity = "intensive" if child.lc_dq < DQ_DELAY_THRESHOLD else "moderate"
        plans.append(InterventionPlanOutput(
            domain="Speech & Language",
            activity="Structured speech stimulation with picture cards and story narration",
            frequency="Daily" if severity == "intensive" else "3x/week",
            duration_minutes=15 if severity == "intensive" else 10,
            caregiver_format="audio",
            priority=1 if severity == "intensive" else 2,
            rationale=f"LC DQ={child.lc_dq:.0f} (below {DQ_CONCERN_THRESHOLD})",
        ))

    # Gross Motor intervention
    if child.gm_dq < DQ_CONCERN_THRESHOLD and child.gm_dq > 0:
        severity = "intensive" if child.gm_dq < DQ_DELAY_THRESHOLD else "moderate"
        plans.append(InterventionPlanOutput(
            domain="Gross Motor",
            activity="Structured physical movement exercises — crawling, climbing, balancing",
            frequency="Daily" if severity == "intensive" else "3x/week",
            duration_minutes=20 if severity == "intensive" else 15,
            caregiver_format="visual",
            priority=1 if severity == "intensive" else 2,
            rationale=f"GM DQ={child.gm_dq:.0f} (below {DQ_CONCERN_THRESHOLD})",
        ))

    # Fine Motor intervention
    if child.fm_dq < DQ_CONCERN_THRESHOLD and child.fm_dq > 0:
        severity = "intensive" if child.fm_dq < DQ_DELAY_THRESHOLD else "moderate"
        plans.append(InterventionPlanOutput(
            domain="Fine Motor",
            activity="Bead threading, clay molding, crayon coloring, and buttoning exercises",
            frequency="Daily" if severity == "intensive" else "4x/week",
            duration_minutes=15,
            caregiver_format="visual",
            priority=1 if severity == "intensive" else 2,
            rationale=f"FM DQ={child.fm_dq:.0f} (below {DQ_CONCERN_THRESHOLD})",
        ))

    # Cognitive intervention
    if child.cog_dq < DQ_CONCERN_THRESHOLD and child.cog_dq > 0:
        severity = "intensive" if child.cog_dq < DQ_DELAY_THRESHOLD else "moderate"
        plans.append(InterventionPlanOutput(
            domain="Cognitive",
            activity="Pattern recognition games, shape sorting, problem-solving puzzles",
            frequency="Daily" if severity == "intensive" else "3x/week",
            duration_minutes=15 if severity == "intensive" else 10,
            caregiver_format="visual",
            priority=1 if severity == "intensive" else 2,
            rationale=f"COG DQ={child.cog_dq:.0f} (below {DQ_CONCERN_THRESHOLD})",
        ))

    # Socio-Emotional intervention
    if child.se_dq < DQ_CONCERN_THRESHOLD and child.se_dq > 0:
        severity = "intensive" if child.se_dq < DQ_DELAY_THRESHOLD else "moderate"
        plans.append(InterventionPlanOutput(
            domain="Socio-Emotional",
            activity="Group play activities, emotion-naming games, turn-taking exercises",
            frequency="3x/week" if severity == "intensive" else "2x/week",
            duration_minutes=15,
            caregiver_format="audio",
            priority=1 if severity == "intensive" else 3,
            rationale=f"SE DQ={child.se_dq:.0f} (below {DQ_CONCERN_THRESHOLD})",
        ))

    # Behavioral intervention
    if child.behaviour_risk_level in ("High", "Moderate"):
        concern = child.behaviour_concerns
        if concern in ("Unknown", "None", ""):
            concern = "General behavioral regulation"
        plans.append(InterventionPlanOutput(
            domain="Behavioral",
            activity=f"Targeted behavioral intervention for {concern.lower()} — positive reinforcement and caregiver guidance",
            frequency="Daily" if child.behaviour_risk_level == "High" else "3x/week",
            duration_minutes=10,
            caregiver_format="audio",
            priority=2,
            rationale=f"Behaviour score={child.behaviour_score}, risk={child.behaviour_risk_level}",
        ))

    # Nutrition intervention
    if child.nutrition_risk in ("High", "Medium"):
        plans.append(InterventionPlanOutput(
            domain="Nutrition",
            activity="Supplementary feeding program + growth monitoring + caregiver nutrition counseling",
            frequency="Daily" if child.nutrition_risk == "High" else "3x/week",
            duration_minutes=0,  # ongoing
            caregiver_format="visual",
            priority=1 if child.nutrition_risk == "High" else 2,
            rationale=f"Nutrition score={child.nutrition_score}, risk={child.nutrition_risk}",
        ))

    # Sort by priority and cap at MAX_INTERVENTION_ACTIVITIES
    plans.sort(key=lambda x: x.priority)
    return plans[:MAX_INTERVENTION_ACTIVITIES]

"""
ECD Risk Engine — Interventions Router
Endpoints for intervention plan generation.
"""

from fastapi import APIRouter

from app.models.schemas import ChildAssessmentInput, InterventionPlanOutput
from app.services.intervention_mapper import generate_intervention_plan

router = APIRouter(prefix="/interventions", tags=["interventions"])


@router.post("/plan", response_model=list[InterventionPlanOutput])
async def get_intervention_plan(child: ChildAssessmentInput) -> list[InterventionPlanOutput]:
    """
    Generate an intervention plan for a child based on their assessment data.
    Returns up to 5 prioritized intervention activities.
    """
    return generate_intervention_plan(child)

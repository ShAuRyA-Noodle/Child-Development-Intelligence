"""
ECD Risk Engine — Alerts Router
Endpoints for alert generation and early warning detection.
"""

from fastapi import APIRouter

from app.models.schemas import (
    ChildAssessmentInput,
    AlertOutput,
    EarlyWarningInput,
    EarlyWarningOutput,
)
from app.services.alert_engine import generate_alerts
from app.services.early_warning import generate_early_warnings
from app.services.longitudinal import (
    AssessmentPoint,
    TrajectoryResult,
    compute_trajectory,
)

router = APIRouter(prefix="/alerts", tags=["alerts"])


@router.post("/generate", response_model=list[AlertOutput])
async def generate_child_alerts(child: ChildAssessmentInput) -> list[AlertOutput]:
    """
    Generate all alerts for a single child assessment.
    """
    return generate_alerts(child)


@router.post("/early-warning", response_model=EarlyWarningOutput)
async def detect_early_warnings(input_data: EarlyWarningInput) -> EarlyWarningOutput:
    """
    Detect early warnings from longitudinal assessment data.
    Requires current assessment and a list of previous assessments.
    """
    return generate_early_warnings(input_data)


@router.post("/trajectory", response_model=TrajectoryResult)
async def compute_child_trajectory(
    assessments: list[AssessmentPoint],
) -> TrajectoryResult:
    """
    Compute developmental trajectory from longitudinal assessment data.
    Requires at least 2 assessment points for meaningful analysis.
    Returns velocity, trajectory classification, catch-up index, and projections.
    """
    return compute_trajectory(assessments)

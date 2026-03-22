"""
ECD Risk Engine — Scoring Router
Endpoints for single and batch risk scoring, TDSC, and M-CHAT-R/F.
"""

import time

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.models.schemas import (
    ChildAssessmentInput,
    RiskScoreOutput,
    BatchScoreRequest,
    BatchScoreResponse,
)
from app.services.rule_engine import compute_risk_score
from app.services.ml_engine import predict, compute_hybrid_score, is_model_loaded
from app.services.tdsc_scorer import compute_tdsc_scores, tdsc_to_assessment_fields
from app.services.mchat_scorer import score_mchat, mchat_to_autism_risk

router = APIRouter(prefix="/scoring", tags=["scoring"])


# ── Request/Response models for screening instruments ──

class TDSCRequest(BaseModel):
    child_id: str
    child_age_months: float = Field(..., gt=0, le=72)
    responses: dict[str, bool] = Field(..., description="Item ID → achieved (true/false)")


class TDSCResponse(BaseModel):
    child_id: str
    domain_dqs: dict[str, float]
    delay_flags: dict[str, int]
    num_delays: int
    developmental_ages: dict[str, float]
    assessment_fields: dict  # Fields compatible with ChildAssessmentInput


class MChatRequest(BaseModel):
    child_id: str
    child_age_months: float = Field(..., gt=0)
    responses: dict[int, bool] = Field(..., description="Item number (1-20) → Yes (true) / No (false)")


class MChatResponse(BaseModel):
    child_id: str
    total_score: int
    risk_level: str
    failed_items: list[int]
    critical_fails: int
    age_valid: bool
    needs_followup: bool
    recommendation: str
    autism_risk_field: str  # Maps to ChildAssessmentInput.autism_risk


@router.post("/score", response_model=RiskScoreOutput)
async def score_child(child: ChildAssessmentInput) -> RiskScoreOutput:
    """
    Compute risk score for a single child.
    Uses the rule engine. If an ML model is loaded, blends with ML prediction.
    """
    rule_result = compute_risk_score(child)

    if is_model_loaded():
        features = child.model_dump()
        ml_result = predict(features)
        return compute_hybrid_score(rule_result, ml_result)

    return rule_result


@router.post("/batch", response_model=BatchScoreResponse)
async def batch_score(request: BatchScoreRequest) -> BatchScoreResponse:
    """
    Compute risk scores for multiple children in a batch.
    """
    start = time.perf_counter()
    scores: list[RiskScoreOutput] = []

    for child in request.children:
        rule_result = compute_risk_score(child)

        if is_model_loaded():
            features = child.model_dump()
            ml_result = predict(features)
            result = compute_hybrid_score(rule_result, ml_result)
        else:
            result = rule_result

        scores.append(result)

    elapsed_ms = (time.perf_counter() - start) * 1000

    return BatchScoreResponse(
        scores=scores,
        processing_time_ms=round(elapsed_ms, 2),
    )


@router.post("/tdsc", response_model=TDSCResponse)
async def score_tdsc(request: TDSCRequest) -> TDSCResponse:
    """
    Score a TDSC (Trivandrum Development Screening Chart) assessment.
    Returns domain DQs, delay flags, and fields ready for risk scoring.
    """
    result = compute_tdsc_scores(request.child_age_months, request.responses)
    assessment_fields = tdsc_to_assessment_fields(result)

    return TDSCResponse(
        child_id=request.child_id,
        domain_dqs=result["domain_dqs"],
        delay_flags=result["delay_flags"],
        num_delays=result["num_delays"],
        developmental_ages=result["developmental_ages"],
        assessment_fields=assessment_fields,
    )


@router.post("/mchat", response_model=MChatResponse)
async def score_mchat_endpoint(request: MChatRequest) -> MChatResponse:
    """
    Score an M-CHAT-R/F autism screening.
    Valid for children aged 16-30 months.
    """
    result = score_mchat(request.responses, request.child_age_months)

    return MChatResponse(
        child_id=request.child_id,
        total_score=result["total_score"],
        risk_level=result["risk_level"],
        failed_items=result["failed_items"],
        critical_fails=result["critical_fails"],
        age_valid=result["age_valid"],
        needs_followup=result["needs_followup"],
        recommendation=result["recommendation"],
        autism_risk_field=mchat_to_autism_risk(result),
    )

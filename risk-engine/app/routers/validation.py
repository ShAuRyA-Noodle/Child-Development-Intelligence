"""
ECD Risk Engine — Validation & Quality Router
Endpoints for DEIC ground truth linkage, inter-rater reliability,
and model validation metrics.
"""

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.services.deic_linkage import (
    DEICReferral,
    DEICDiagnosis,
    LinkageRecord,
    ValidationMetrics,
    link_predictions_to_diagnoses,
    compute_validation_metrics,
    compute_calibration_curve,
)
from app.services.inter_rater import (
    RaterAssessment,
    IRRResult,
    compute_irr,
)

router = APIRouter(prefix="/validation", tags=["validation"])


class DEICLinkageRequest(BaseModel):
    referrals: list[DEICReferral]
    diagnoses: list[DEICDiagnosis]


class DEICLinkageResponse(BaseModel):
    linked_records: list[LinkageRecord]
    metrics: ValidationMetrics
    calibration: dict


class IRRRequest(BaseModel):
    assessments: list[RaterAssessment]


@router.post("/deic-linkage", response_model=DEICLinkageResponse)
async def deic_linkage(request: DEICLinkageRequest) -> DEICLinkageResponse:
    """
    Link screening predictions to DEIC clinical diagnoses.
    Computes validation metrics (sensitivity, specificity, PPV, NPV,
    Cohen's kappa) and calibration curve.
    """
    linked = link_predictions_to_diagnoses(request.referrals, request.diagnoses)
    metrics = compute_validation_metrics(linked)
    calibration = compute_calibration_curve(linked)

    return DEICLinkageResponse(
        linked_records=linked,
        metrics=metrics,
        calibration=calibration,
    )


@router.post("/inter-rater-reliability", response_model=IRRResult)
async def inter_rater_reliability(request: IRRRequest) -> IRRResult:
    """
    Compute inter-rater reliability between AWW assessments.
    Returns Cohen's kappa, ICC, percentage agreement, and Bland-Altman stats.
    """
    return compute_irr(request.assessments)

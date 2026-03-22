"""
ECD Risk Engine — Equity & Bias Audit Router
Endpoints for bias auditing and equity analysis.
"""

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.services.bias_audit import (
    run_bias_audit,
    BiasAuditResult,
    EQUITY_FIELDS,
)

router = APIRouter(prefix="/equity", tags=["equity"])


class BiasAuditRequest(BaseModel):
    """Request for a bias audit on a batch of children."""
    children: list[dict] = Field(
        ..., description="List of ChildAssessmentInput-compatible dicts"
    )
    equity_data: dict[str, dict[str, str]] = Field(
        ...,
        description="Mapping of child_id → {equity_field: value}",
    )


@router.post("/audit", response_model=BiasAuditResult)
async def bias_audit(request: BiasAuditRequest) -> BiasAuditResult:
    """
    Run a bias audit across demographic subgroups.
    Checks for disparate impact using the 4/5ths rule.
    """
    return run_bias_audit(request.children, request.equity_data)


@router.get("/fields")
async def get_equity_fields() -> dict:
    """Return the list of equity demographic fields used for bias auditing."""
    return {
        "fields": EQUITY_FIELDS,
        "description": (
            "These fields are used ONLY for fairness analysis. "
            "They are never used as inputs to the risk scoring algorithm."
        ),
    }

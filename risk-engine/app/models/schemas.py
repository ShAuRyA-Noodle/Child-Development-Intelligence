"""
ECD Risk Engine — Pydantic v2 Schemas
Request/response models for all API endpoints.
"""

from pydantic import BaseModel, Field
from typing import Optional


class ChildAssessmentInput(BaseModel):
    """Input data for a single child assessment."""
    child_id: str = Field(..., description="Unique child identifier")
    age_months: int = Field(0, description="Child age in months")

    # Developmental delays (binary: 0 or 1)
    gm_delay: int = Field(0, ge=0, le=1, description="Gross Motor delay flag")
    fm_delay: int = Field(0, ge=0, le=1, description="Fine Motor delay flag")
    lc_delay: int = Field(0, ge=0, le=1, description="Language/Communication delay flag")
    cog_delay: int = Field(0, ge=0, le=1, description="Cognitive delay flag")
    se_delay: int = Field(0, ge=0, le=1, description="Socio-Emotional delay flag")

    # Developmental Quotient scores
    gm_dq: float = Field(0.0, ge=0, description="Gross Motor DQ")
    fm_dq: float = Field(0.0, ge=0, description="Fine Motor DQ")
    lc_dq: float = Field(0.0, ge=0, description="Language/Communication DQ")
    cog_dq: float = Field(0.0, ge=0, description="Cognitive DQ")
    se_dq: float = Field(0.0, ge=0, description="Socio-Emotional DQ")
    composite_dq: float = Field(0.0, ge=0, description="Composite DQ")

    # Neuro-behavioral risk levels
    autism_risk: str = Field("Low", description="Autism risk: High, Moderate, Low")
    adhd_risk: str = Field("Low", description="ADHD risk: High, Moderate, Low")
    behavior_risk: str = Field("Low", description="Behavior risk: High, Moderate, Low")

    # Nutrition
    nutrition_score: int = Field(0, ge=0, description="Nutrition composite score")
    nutrition_risk: str = Field("Low", description="Nutrition risk: High, Medium, Low")

    # Behaviour
    behaviour_score: int = Field(0, ge=0, description="Behaviour score")
    behaviour_risk_level: str = Field("Low", description="Behaviour risk level: High, Moderate, Low")
    behaviour_concerns: str = Field("None", description="Specific behaviour concerns")

    # Environment / Caregiving
    parent_child_interaction_score: int = Field(0, ge=0, description="Parent-child interaction score")
    parent_mental_health_score: int = Field(0, ge=0, description="Parent mental health score (0-5)")
    home_stimulation_score: int = Field(0, ge=0, description="Home stimulation score (0-5)")
    caregiver_engagement: str = Field("Moderate", description="Caregiver engagement: High, Moderate, Low")
    language_exposure: str = Field("Adequate", description="Language exposure: Adequate, Inadequate")
    play_materials: str = Field("No", description="Play materials available: Yes/No")
    safe_water: str = Field("No", description="Safe water access: Yes/No")
    toilet_facility: str = Field("No", description="Toilet facility available: Yes/No")

    # WHO z-score nutrition (v2 — replaces nutrition_score integer)
    weight_kg: Optional[float] = Field(None, ge=0, description="Weight in kg for WHO z-score")
    height_cm: Optional[float] = Field(None, ge=0, description="Height in cm for WHO z-score")
    muac_cm: Optional[float] = Field(None, ge=0, description="MUAC in cm for acute malnutrition check")
    gender_code: Optional[str] = Field(None, description="M or F for WHO LMS tables")
    gestational_weeks: Optional[int] = Field(None, ge=20, le=45, description="Gestational age at birth (for prematurity correction)")

    @property
    def num_delays(self) -> int:
        return self.gm_delay + self.fm_delay + self.lc_delay + self.cog_delay + self.se_delay


class ContributingDomain(BaseModel):
    """A single domain contributing to the risk score."""
    domain: str
    points: int
    reason: str


class RiskScoreOutput(BaseModel):
    """Risk score result for a single child.
    Dual output: old_* uses flat 5-pt weights + old thresholds,
                 new_* uses regression weights + v2 thresholds.
    Top-level risk_score/risk_category always use v2 (new).
    """
    child_id: str
    risk_score: int            # v2 score (primary)
    risk_category: str         # v2 category (primary)
    old_score: int = 0         # legacy flat-weight score
    old_category: str = "Low"  # legacy category
    confidence: float
    contributing_domains: list[ContributingDomain]
    composite_dq: float
    composite_dq_zscore: Optional[float] = None
    # WHO z-score nutrition output (v2)
    waz: Optional[float] = None
    haz: Optional[float] = None
    whz: Optional[float] = None
    who_nutrition_risk: Optional[str] = None


class AlertOutput(BaseModel):
    """A single alert for a child."""
    alert_id: str
    child_id: str
    domain: str
    indicator: str
    severity: str
    confidence: float
    dq_value: Optional[float] = None
    message: str
    suggested_action: str


class InterventionPlanOutput(BaseModel):
    """A single intervention activity recommendation."""
    domain: str
    activity: str
    frequency: str
    duration_minutes: int
    caregiver_format: str
    priority: int
    rationale: str


class BatchScoreRequest(BaseModel):
    """Batch scoring request with multiple children."""
    children: list[ChildAssessmentInput]


class BatchScoreResponse(BaseModel):
    """Batch scoring response."""
    scores: list[RiskScoreOutput]
    processing_time_ms: float


class EarlyWarningInput(BaseModel):
    """Input for early warning detection requiring longitudinal data."""
    child_id: str
    current_assessment: ChildAssessmentInput
    previous_assessments: list[ChildAssessmentInput] = Field(default_factory=list)


class EarlyWarningOutput(BaseModel):
    """Early warning detection results."""
    child_id: str
    warnings: list[AlertOutput]

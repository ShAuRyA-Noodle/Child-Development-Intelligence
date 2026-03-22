"""
ECD Risk Engine — Longitudinal Assessment Architecture
Tracks developmental trajectories over time with velocity analysis,
trajectory classification, and age-expected progress benchmarks.

Key concepts:
- Developmental Velocity: rate of DQ change per month
- Trajectory Class: Improving / Stable / Declining / Volatile
- Catch-up Index: ratio of actual progress to expected progress
"""

from __future__ import annotations
import math
from typing import Optional
from pydantic import BaseModel, Field


class AssessmentPoint(BaseModel):
    """A single assessment point in a child's timeline."""
    child_id: str
    age_months: float
    assessment_date: str  # ISO format YYYY-MM-DD
    composite_dq: float
    domain_dqs: dict[str, float] = Field(
        default_factory=dict,
        description="Domain DQs: gm, fm, lc, cog, se",
    )
    risk_category: str = "Low"
    risk_score: int = 0


class DomainVelocity(BaseModel):
    """Developmental velocity for a single domain."""
    domain: str
    velocity_per_month: float  # DQ points per month
    direction: str  # "improving", "stable", "declining"
    r_squared: float  # goodness of fit (0-1)


class TrajectoryResult(BaseModel):
    """Complete longitudinal trajectory analysis for a child."""
    child_id: str
    num_assessments: int
    age_span_months: float
    composite_velocity: float  # DQ points per month
    trajectory_class: str  # Improving / Stable / Declining / Volatile
    domain_velocities: list[DomainVelocity]
    catch_up_index: Optional[float] = None
    projected_dq_6mo: Optional[float] = None
    projected_dq_12mo: Optional[float] = None
    trend_confidence: float  # 0-1, how reliable the trend estimate is
    interpretation: str


def _linear_regression(x: list[float], y: list[float]) -> tuple[float, float, float]:
    """
    Simple linear regression: y = slope * x + intercept.
    Returns (slope, intercept, r_squared).
    """
    n = len(x)
    if n < 2:
        return (0.0, y[0] if y else 0.0, 0.0)

    sum_x = sum(x)
    sum_y = sum(y)
    sum_xy = sum(xi * yi for xi, yi in zip(x, y))
    sum_x2 = sum(xi ** 2 for xi in x)
    sum_y2 = sum(yi ** 2 for yi in y)

    denom = n * sum_x2 - sum_x ** 2
    if abs(denom) < 1e-10:
        return (0.0, sum_y / n, 0.0)

    slope = (n * sum_xy - sum_x * sum_y) / denom
    intercept = (sum_y - slope * sum_x) / n

    # R-squared
    ss_res = sum((yi - (slope * xi + intercept)) ** 2 for xi, yi in zip(x, y))
    mean_y = sum_y / n
    ss_tot = sum((yi - mean_y) ** 2 for yi in y)

    r_squared = 1 - (ss_res / ss_tot) if ss_tot > 1e-10 else 0.0
    r_squared = max(0.0, min(1.0, r_squared))

    return (slope, intercept, r_squared)


def _classify_velocity(velocity: float, r_squared: float) -> str:
    """Classify a developmental velocity into a direction."""
    if r_squared < 0.3:
        return "volatile"
    if velocity > 0.5:
        return "improving"
    elif velocity < -0.5:
        return "declining"
    return "stable"


def _classify_trajectory(
    composite_velocity: float,
    domain_velocities: list[DomainVelocity],
    r_squared: float,
) -> str:
    """
    Classify the overall trajectory based on velocity and consistency.
    """
    if r_squared < 0.2:
        return "Volatile"

    declining_count = sum(1 for dv in domain_velocities if dv.direction == "declining")
    improving_count = sum(1 for dv in domain_velocities if dv.direction == "improving")

    if composite_velocity > 0.5 and improving_count >= 2:
        return "Improving"
    elif composite_velocity < -0.5 and declining_count >= 2:
        return "Declining"
    elif abs(composite_velocity) <= 0.5:
        return "Stable"
    elif declining_count >= 3:
        return "Declining"
    elif improving_count >= 3:
        return "Improving"

    return "Stable"


# Age-expected DQ benchmarks (typical development = DQ stays ~100)
# Children with delays should show catch-up if interventions work.
AGE_EXPECTED_DQ = 100.0  # By definition, DQ=100 means age-appropriate


def compute_trajectory(
    assessments: list[AssessmentPoint],
) -> TrajectoryResult:
    """
    Compute developmental trajectory from a series of assessments.

    Args:
        assessments: List of AssessmentPoint, sorted by age_months ascending.
                     Minimum 2 points required for meaningful analysis.

    Returns:
        TrajectoryResult with velocity, classification, and projections.
    """
    if not assessments:
        return TrajectoryResult(
            child_id="unknown",
            num_assessments=0,
            age_span_months=0,
            composite_velocity=0,
            trajectory_class="Insufficient Data",
            domain_velocities=[],
            trend_confidence=0,
            interpretation="No assessments available for trajectory analysis.",
        )

    child_id = assessments[0].child_id
    assessments = sorted(assessments, key=lambda a: a.age_months)
    n = len(assessments)

    if n < 2:
        return TrajectoryResult(
            child_id=child_id,
            num_assessments=1,
            age_span_months=0,
            composite_velocity=0,
            trajectory_class="Insufficient Data",
            domain_velocities=[],
            trend_confidence=0,
            interpretation=(
                f"Only 1 assessment at {assessments[0].age_months} months "
                f"(DQ={assessments[0].composite_dq:.0f}). "
                f"Need at least 2 assessments for trajectory analysis."
            ),
        )

    ages = [a.age_months for a in assessments]
    age_span = ages[-1] - ages[0]

    # Composite DQ trajectory
    composite_dqs = [a.composite_dq for a in assessments]
    slope, intercept, r_sq = _linear_regression(ages, composite_dqs)

    # Domain-level velocities
    all_domains = ["gm", "fm", "lc", "cog", "se"]
    domain_velocities: list[DomainVelocity] = []

    for domain in all_domains:
        domain_values = [a.domain_dqs.get(domain, 0) for a in assessments]
        if all(v == 0 for v in domain_values):
            continue

        d_slope, _, d_r2 = _linear_regression(ages, domain_values)
        direction = _classify_velocity(d_slope, d_r2)

        domain_velocities.append(DomainVelocity(
            domain=domain,
            velocity_per_month=round(d_slope, 3),
            direction=direction,
            r_squared=round(d_r2, 3),
        ))

    # Trajectory classification
    trajectory_class = _classify_trajectory(slope, domain_velocities, r_sq)

    # Projections (only if reasonable fit)
    projected_6mo = None
    projected_12mo = None
    if r_sq >= 0.3 and n >= 3:
        future_age_6 = ages[-1] + 6
        future_age_12 = ages[-1] + 12
        projected_6mo = round(slope * future_age_6 + intercept, 1)
        projected_12mo = round(slope * future_age_12 + intercept, 1)
        # Clamp projections to reasonable range
        projected_6mo = max(0, min(200, projected_6mo))
        projected_12mo = max(0, min(200, projected_12mo))

    # Catch-up index: how much progress vs expected
    # If child started below 100, are they closing the gap?
    catch_up_index = None
    if n >= 3 and assessments[0].composite_dq < AGE_EXPECTED_DQ:
        initial_gap = AGE_EXPECTED_DQ - assessments[0].composite_dq
        current_gap = AGE_EXPECTED_DQ - assessments[-1].composite_dq
        if initial_gap > 0:
            catch_up_index = round(1 - (current_gap / initial_gap), 3)
            # > 0 means catching up, < 0 means falling further behind

    # Trend confidence based on number of points and R²
    trend_confidence = min(0.95, r_sq * (1 - 1 / max(n, 2)))
    trend_confidence = round(max(0, trend_confidence), 3)

    # Interpretation
    latest_dq = assessments[-1].composite_dq
    interpretation_parts = [
        f"Child assessed {n} times over {age_span:.0f} months.",
        f"Current composite DQ: {latest_dq:.0f}.",
        f"Trajectory: {trajectory_class} (velocity: {slope:+.2f} DQ/month).",
    ]

    if catch_up_index is not None:
        if catch_up_index > 0.1:
            interpretation_parts.append(
                f"Catch-up index: {catch_up_index:.2f} — gap narrowing, interventions appear effective."
            )
        elif catch_up_index < -0.1:
            interpretation_parts.append(
                f"Catch-up index: {catch_up_index:.2f} — gap widening, review intervention plan."
            )
        else:
            interpretation_parts.append(
                f"Catch-up index: {catch_up_index:.2f} — gap stable."
            )

    if projected_6mo is not None:
        interpretation_parts.append(
            f"Projected DQ in 6 months: {projected_6mo:.0f}, 12 months: {projected_12mo:.0f}."
        )

    declining_domains = [dv.domain for dv in domain_velocities if dv.direction == "declining"]
    if declining_domains:
        interpretation_parts.append(
            f"Declining domains: {', '.join(declining_domains)} — prioritize intervention."
        )

    return TrajectoryResult(
        child_id=child_id,
        num_assessments=n,
        age_span_months=round(age_span, 1),
        composite_velocity=round(slope, 3),
        trajectory_class=trajectory_class,
        domain_velocities=domain_velocities,
        catch_up_index=catch_up_index,
        projected_dq_6mo=projected_6mo,
        projected_dq_12mo=projected_12mo,
        trend_confidence=trend_confidence,
        interpretation=" ".join(interpretation_parts),
    )

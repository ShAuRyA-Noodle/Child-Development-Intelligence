"""
ECD Risk Engine — Alert Generation Engine
Ported from scripts/process_data.py lines 322-420.
"""

from app.models.schemas import ChildAssessmentInput, AlertOutput
from app.utils.constants import (
    DQ_DELAY_THRESHOLD,
    DQ_ALERT_DOMAINS,
    ALERT_ACTIONS,
    DEFAULT_ALERT_ACTION,
    MAX_ALERT_CONFIDENCE,
)

# Module-level alert counter for generating unique IDs within a session
_alert_counter = 0


def _next_alert_id() -> str:
    """Generate a unique alert ID."""
    global _alert_counter
    _alert_counter += 1
    return f"ALT_{_alert_counter:05d}"


def reset_alert_counter() -> None:
    """Reset the alert counter (useful for batch processing)."""
    global _alert_counter
    _alert_counter = 0


def get_alert_action(domain: str, severity: str) -> str:
    """
    Generate suggested action based on domain and severity.
    Ported from process_data.py get_alert_action().
    """
    return ALERT_ACTIONS.get(domain, {}).get(severity, DEFAULT_ALERT_ACTION)


def generate_alerts(child: ChildAssessmentInput) -> list[AlertOutput]:
    """
    Generate all alerts for a child assessment.
    Ported from process_data.py lines 328-397.
    """
    alerts: list[AlertOutput] = []

    # Alert 1: Domain-specific DQ delays
    for domain, dq_key, label in DQ_ALERT_DOMAINS:
        dq = getattr(child, dq_key)
        if dq < DQ_DELAY_THRESHOLD and dq > 0:
            severity = "critical" if dq < 60 else "high" if dq < 70 else "moderate"
            confidence = min(
                MAX_ALERT_CONFIDENCE,
                round(90 + (DQ_DELAY_THRESHOLD - dq) / 10, 1),
            )
            alerts.append(AlertOutput(
                alert_id=_next_alert_id(),
                child_id=child.child_id,
                domain=domain,
                indicator=label,
                severity=severity,
                confidence=confidence,
                dq_value=dq,
                message=f"{label} DQ={dq:.0f} (threshold: {DQ_DELAY_THRESHOLD})",
                suggested_action=get_alert_action(domain, severity),
            ))

    # Alert 2: High autism risk
    if child.autism_risk == "High":
        alerts.append(AlertOutput(
            alert_id=_next_alert_id(),
            child_id=child.child_id,
            domain="Behavioral",
            indicator="Autism Screening",
            severity="critical",
            confidence=94,
            dq_value=None,
            message="High autism risk detected — requires specialist referral",
            suggested_action="Priority referral to RBSK/DEIC for autism screening",
        ))

    # Alert 3: Multiple delays (>=3) — Global Developmental Delay
    num_delays = child.num_delays
    if num_delays >= 3:
        alerts.append(AlertOutput(
            alert_id=_next_alert_id(),
            child_id=child.child_id,
            domain="Multi-domain",
            indicator="Global Developmental Delay",
            severity="critical",
            confidence=96,
            dq_value=child.composite_dq,
            message=f"Global delay: {num_delays} domains affected, Composite DQ={child.composite_dq:.0f}",
            suggested_action="Urgent multi-domain intervention + specialist referral",
        ))

    # Alert 4: Severe malnutrition
    if child.nutrition_score >= 5:
        alerts.append(AlertOutput(
            alert_id=_next_alert_id(),
            child_id=child.child_id,
            domain="Nutrition",
            indicator="Severe Malnutrition",
            severity="high",
            confidence=92,
            dq_value=None,
            message=f"Nutrition score {child.nutrition_score}: high malnutrition risk",
            suggested_action="Refer to NRC; supplementary nutrition program; growth monitoring",
        ))

    return alerts

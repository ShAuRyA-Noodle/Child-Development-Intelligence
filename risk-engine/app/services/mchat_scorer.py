"""
M-CHAT-R/F (Modified Checklist for Autism in Toddlers, Revised with Follow-Up)
Validated autism screening for children aged 16-30 months.

Reference: Robins DL, Fein D, Barton ML (2009). "Modified Checklist for Autism
           in Toddlers, Revised, with Follow-Up (M-CHAT-R/F)."
           Pediatrics, 133(1), 37-45.

Scoring:
  - 20 yes/no items. For most items, "No" = at risk (fail).
  - Items 2, 5, 12 are reverse-scored ("Yes" = fail).
  - Total score = number of failed items (0-20).
  - Risk tiers:
      0-2  → Low risk (no follow-up needed unless prior concern)
      3-7  → Medium risk (administer Follow-Up for failed items)
      8-20 → High risk (refer immediately for diagnostic evaluation)
"""

from __future__ import annotations

# Items where "Yes" = FAIL (reverse-scored)
REVERSE_SCORED_ITEMS = {2, 5, 12}

# All 20 M-CHAT-R items with their content (for reference/validation)
MCHAT_ITEMS = {
    1:  "Does your child look at you when you call his/her name?",
    2:  "Does your child seem unusually sensitive to noise?",
    3:  "Does your child point to ask for something or to get help?",
    4:  "Does your child pretend play (e.g., feed a doll)?",
    5:  "Does your child seem overly active, uncooperative, or oppositional?",
    6:  "Does your child use index finger to point to indicate interest?",
    7:  "Does your child show interest in other children?",
    8:  "Does your child show you things by bringing or holding them up?",
    9:  "Does your child respond to his/her name when called?",
    10: "Does your child smile in response to your face or smile?",
    11: "Does your child get upset by everyday sounds?",
    12: "Does your child walk?",
    13: "Does your child make eye contact with you?",
    14: "Does your child try to copy what you do?",
    15: "If you turn your head to look at something, does your child look at what you are looking at?",
    16: "Does your child try to get you to watch him/her?",
    17: "Does your child understand when you tell him/her something?",
    18: "When something new happens, does your child look at your face to see how you feel?",
    19: "Does your child like movement activities (e.g., being swung)?",
    20: "Does your child wave goodbye without being told to?",
}

# Critical items (higher specificity for ASD)
CRITICAL_ITEMS = {2, 6, 7, 9, 13, 14, 15}


def score_mchat(
    responses: dict[int, bool],
    child_age_months: float,
) -> dict:
    """
    Score M-CHAT-R/F responses.

    Args:
        responses: Dict mapping item number (1-20) → True (Yes) / False (No)
        child_age_months: Age in months (valid range: 16-30)

    Returns:
        dict with keys:
            total_score: int (0-20, number of failed items)
            risk_level: str ("Low", "Medium", "High")
            failed_items: list[int]
            critical_fails: int (number of critical items failed)
            age_valid: bool (whether child is in valid age range)
            needs_followup: bool
            recommendation: str
    """
    age_valid = 16 <= child_age_months <= 30

    failed_items: list[int] = []

    for item_num in range(1, 21):
        answer = responses.get(item_num)
        if answer is None:
            # Missing response counts as fail (conservative)
            failed_items.append(item_num)
            continue

        if item_num in REVERSE_SCORED_ITEMS:
            # "Yes" = fail for reverse-scored items
            if answer is True:
                failed_items.append(item_num)
        else:
            # "No" = fail for regular items
            if answer is False:
                failed_items.append(item_num)

    total_score = len(failed_items)
    critical_fails = len([i for i in failed_items if i in CRITICAL_ITEMS])

    # Risk classification
    if total_score >= 8:
        risk_level = "High"
        needs_followup = False  # Skip Follow-Up, refer directly
        recommendation = (
            "Immediate referral for diagnostic evaluation and early intervention. "
            "Do not wait for Follow-Up interview."
        )
    elif total_score >= 3:
        risk_level = "Medium"
        needs_followup = True
        recommendation = (
            "Administer M-CHAT-R Follow-Up interview for the failed items. "
            "If Follow-Up score remains >= 2, refer for diagnostic evaluation."
        )
    else:
        risk_level = "Low"
        needs_followup = False
        recommendation = (
            "Low risk. No immediate action needed. "
            "Re-screen at 24-month well-child visit if not yet done."
        )

    return {
        "total_score": total_score,
        "risk_level": risk_level,
        "failed_items": failed_items,
        "critical_fails": critical_fails,
        "age_valid": age_valid,
        "needs_followup": needs_followup,
        "recommendation": recommendation,
    }


def mchat_to_autism_risk(mchat_result: dict) -> str:
    """
    Convert M-CHAT-R/F result to the autism_risk field used by the risk engine.
    Maps M-CHAT risk levels to the ChildAssessmentInput.autism_risk field.
    """
    level = mchat_result["risk_level"]
    if level == "High":
        return "High"
    elif level == "Medium":
        return "Moderate"
    return "Low"

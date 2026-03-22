"""
TDSC (Trivandrum Development Screening Chart) Scoring Engine
Implements the validated 20-item developmental screening instrument.

Reference: Nair MKC et al. "Trivandrum Development Screening Chart"
           Indian Pediatrics, 1991; 28: 869-876.

Scoring: For each domain (GM, FM, LC, SE), compute a Developmental Quotient:
  DQ = (developmental_age / chronological_age) × 100
  developmental_age = highest milestone achieved × p90_months

Delay detection: DQ < 75 → delay flag = 1
"""

from __future__ import annotations
from typing import Optional


# ── TDSC items with 90th percentile age norms (months) ──
# Each item: (id, domain, p90_months)
TDSC_ITEMS: list[tuple[str, str, float]] = [
    # Gross Motor
    ("gm1", "gm", 4),   # Holds head steady
    ("gm2", "gm", 5),   # Rolls over
    ("gm3", "gm", 9),   # Sits without support
    ("gm4", "gm", 10),  # Stands holding on
    ("gm5", "gm", 14),  # Walks alone
    ("gm6", "gm", 18),  # Runs
    # Fine Motor
    ("fm1", "fm", 4),   # Grasps rattle
    ("fm2", "fm", 6),   # Transfers objects
    ("fm3", "fm", 9),   # Pincer grasp
    ("fm4", "fm", 12),  # Scribbles
    ("fm5", "fm", 24),  # Tower of 6 cubes
    # Language/Communication
    ("lc1", "lc", 3),   # Coos/vocalizes
    ("lc2", "lc", 6),   # Turns to sound
    ("lc3", "lc", 9),   # Babbles
    ("lc4", "lc", 12),  # First words
    ("lc5", "lc", 24),  # Two-word phrases
    ("lc6", "lc", 36),  # Sentences
    # Socio-Emotional
    ("se1", "se", 3),   # Social smile
    ("se2", "se", 9),   # Stranger anxiety
    ("se3", "se", 18),  # Parallel play
]

# DQ threshold for delay detection
DQ_DELAY_THRESHOLD = 75


def compute_tdsc_scores(
    child_age_months: float,
    responses: dict[str, bool],
) -> dict:
    """
    Compute TDSC domain DQs and delay flags from item responses.

    Args:
        child_age_months: Chronological age in months
        responses: Dict mapping item_id → True (achieved) / False (not achieved)

    Returns:
        dict with keys:
            domain_dqs: {gm: float, fm: float, lc: float, se: float}
            delay_flags: {gm_delay: int, fm_delay: int, lc_delay: int, se_delay: int}
            num_delays: int
            developmental_ages: {gm: float, fm: float, lc: float, se: float}
    """
    if child_age_months <= 0:
        child_age_months = 1  # prevent division by zero

    # Group items by domain
    domain_items: dict[str, list[tuple[str, float]]] = {
        "gm": [], "fm": [], "lc": [], "se": [],
    }
    for item_id, domain, p90 in TDSC_ITEMS:
        domain_items[domain].append((item_id, p90))

    # Sort each domain's items by p90 ascending
    for domain in domain_items:
        domain_items[domain].sort(key=lambda x: x[1])

    domain_dqs: dict[str, float] = {}
    delay_flags: dict[str, int] = {}
    developmental_ages: dict[str, float] = {}

    for domain, items in domain_items.items():
        # Find highest achieved milestone's p90_months
        dev_age = 0.0
        for item_id, p90 in items:
            if responses.get(item_id, False):
                dev_age = p90

        developmental_ages[domain] = dev_age

        # DQ = (developmental_age / chronological_age) × 100
        dq = (dev_age / child_age_months) * 100 if child_age_months > 0 else 0
        dq = min(200, round(dq, 1))  # cap at 200
        domain_dqs[domain] = dq

        delay_flags[f"{domain}_delay"] = 1 if dq < DQ_DELAY_THRESHOLD else 0

    num_delays = sum(delay_flags.values())

    return {
        "domain_dqs": domain_dqs,
        "delay_flags": delay_flags,
        "num_delays": num_delays,
        "developmental_ages": developmental_ages,
    }


def tdsc_to_assessment_fields(tdsc_result: dict) -> dict:
    """
    Convert TDSC scoring output to ChildAssessmentInput-compatible fields.
    Used to map TDSC results into the risk scoring pipeline.
    """
    dqs = tdsc_result["domain_dqs"]
    flags = tdsc_result["delay_flags"]

    composite_dq = sum(dqs.values()) / len(dqs) if dqs else 0

    return {
        "gm_dq": dqs.get("gm", 0),
        "fm_dq": dqs.get("fm", 0),
        "lc_dq": dqs.get("lc", 0),
        "se_dq": dqs.get("se", 0),
        "cog_dq": dqs.get("gm", 0),  # TDSC has no cognitive domain; proxy with GM
        "composite_dq": round(composite_dq, 1),
        "gm_delay": flags.get("gm_delay", 0),
        "fm_delay": flags.get("fm_delay", 0),
        "lc_delay": flags.get("lc_delay", 0),
        "se_delay": flags.get("se_delay", 0),
        "cog_delay": 0,  # Not assessed by TDSC
    }

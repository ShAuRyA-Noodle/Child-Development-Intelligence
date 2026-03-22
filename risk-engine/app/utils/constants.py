"""
ECD Risk Engine — Constants
All scoring weights, thresholds, and configuration values.
Ported from scripts/process_data.py.

v2: Updated domain weights from logistic regression on 1,000-child dataset.
    Added environmental risk factors. Recalibrated thresholds.
    Reduced ADHD/behaviour weights based on validation analysis.
"""

# ── v2 domain-specific delay weights (logistic regression coefficients) ──
DELAY_DOMAIN_WEIGHTS: dict[str, int] = {
    "lc_delay":  8,   # Language/Communication — strongest predictor
    "gm_delay":  7,   # Gross Motor
    "fm_delay":  7,   # Fine Motor
    "cog_delay": 6,   # Cognitive
    "se_delay":  5,   # Socio-Emotional
}

# Legacy flat weight (kept for old_score backward compatibility)
DELAY_DOMAIN_POINTS = 5

# ── v2 environmental risk add-ons ──
ENV_RISK_HOME_STIMULATION_THRESHOLD = 2    # score <= this → +3
ENV_RISK_HOME_STIMULATION_POINTS = 3
ENV_RISK_PARENT_MENTAL_HEALTH_THRESHOLD = 2  # score <= this → +2
ENV_RISK_PARENT_MENTAL_HEALTH_POINTS = 2
ENV_RISK_LOW_CAREGIVER_ENGAGEMENT_POINTS = 2  # caregiver_engagement == 'Low' → +2
ENV_RISK_INADEQUATE_LANGUAGE_EXPOSURE_POINTS = 2  # language_exposure == 'Inadequate' → +2

AUTISM_RISK_POINTS = {"High": 15, "Moderate": 8, "Low": 0}

# v2 reduced weights (from validation analysis)
ADHD_RISK_POINTS = {"High": 5, "Moderate": 3, "Low": 0}
BEHAVIORAL_RISK_POINTS = {"High": 5, "Moderate": 2, "Low": 0}

# Legacy weights (for old_score)
ADHD_RISK_POINTS_V1 = {"High": 8, "Moderate": 4, "Low": 0}
BEHAVIORAL_RISK_POINTS_V1 = {"High": 7, "Moderate": 3, "Low": 0}

# ── v2 risk thresholds (recalibrated for higher-resolution scoring) ──
# Old: Low ≤ 10, Medium 11-25, High > 25
# New: Low ≤ 12, Medium 13-32, High > 32
RISK_THRESHOLDS_V2: dict[str, int] = {"Low": 12, "Medium": 32}

# Legacy thresholds (for old_score)
RISK_THRESHOLDS = {"Low": 10, "Medium": 25}

# Domain DQ thresholds
DQ_DELAY_THRESHOLD = 75   # Below this = delay in domain
DQ_CONCERN_THRESHOLD = 85  # Below this = at-risk in domain

# Delay domain fields and their human-readable labels
DELAY_DOMAINS = [
    ("gm_delay", "Gross Motor"),
    ("fm_delay", "Fine Motor"),
    ("lc_delay", "Language/Communication"),
    ("cog_delay", "Cognitive"),
    ("se_delay", "Socio-Emotional"),
]

# DQ domain fields used for alerts
DQ_ALERT_DOMAINS = [
    ("Speech", "lc_dq", "Language/Communication"),
    ("Motor", "gm_dq", "Gross Motor"),
    ("Motor", "fm_dq", "Fine Motor"),
    ("Cognitive", "cog_dq", "Cognitive"),
    ("Socio-emotional", "se_dq", "Socio-Emotional"),
]

# Alert suggested actions per domain and severity
ALERT_ACTIONS = {
    "Speech": {
        "critical": "Urgent speech therapy referral; daily structured speech stimulation; parent audio guidance",
        "high": "Speech assessment referral; 3x/week picture card narration; caregiver communication training",
        "moderate": "Monitor speech development; 2x/week story narration activities",
    },
    "Motor": {
        "critical": "Physiotherapy referral; daily structured motor exercises; occupational therapy assessment",
        "high": "Motor development assessment; daily fine/gross motor activities; parent demonstration",
        "moderate": "Regular motor activities; play-based movement exercises 3x/week",
    },
    "Cognitive": {
        "critical": "Specialist cognitive assessment; daily structured learning activities; parent guidance",
        "high": "Cognitive stimulation program; 3x/week problem-solving games; home activity kit",
        "moderate": "Pattern recognition games 2x/week; age-appropriate puzzles",
    },
    "Socio-emotional": {
        "critical": "Child psychologist referral; daily social interaction activities; caregiver counseling",
        "high": "Group play therapy; 3x/week emotion recognition exercises; parent support",
        "moderate": "Social play activities 2x/week; peer interaction monitoring",
    },
}

DEFAULT_ALERT_ACTION = "Regular monitoring and follow-up assessment"

# Confidence bounds
MAX_RISK_CONFIDENCE = 98
MAX_ALERT_CONFIDENCE = 97

# ── Calibrated confidence configuration ──
# Data completeness fields — grouped by tier (core vs supplementary)
COMPLETENESS_CORE_FIELDS = [
    "gm_dq", "fm_dq", "lc_dq", "cog_dq", "se_dq",
]
COMPLETENESS_SUPPLEMENTARY_FIELDS = [
    "behaviour_score", "nutrition_score",
    "home_stimulation_score", "parent_mental_health_score",
]
# Legacy flat list (kept for backward compatibility)
COMPLETENESS_FIELDS = COMPLETENESS_CORE_FIELDS + COMPLETENESS_SUPPLEMENTARY_FIELDS[:2]

# Calibrated confidence weights
CONF_BASE = 0.40             # Base confidence when minimal data available
CONF_CORE_WEIGHT = 0.30      # Weight for core DQ domain completeness
CONF_SUPP_WEIGHT = 0.10      # Weight for supplementary field completeness
CONF_WHO_WEIGHT = 0.08       # Weight for WHO anthropometric data present
CONF_AGREEMENT_WEIGHT = 0.12 # Weight for cross-domain signal agreement

# Signal agreement: if ≥ this fraction of domains agree with the category,
# confidence gets the full agreement bonus
CONF_AGREEMENT_THRESHOLD = 0.6

# Maximum number of intervention activities per child
MAX_INTERVENTION_ACTIVITIES = 5

"""
WHO LMS Z-Score Calculator for WAZ, HAZ, WHZ
Uses WHO Child Growth Standards (0-60 months) with embedded reference tables.
Formula: z = [(X/M)^L - 1] / (L × S)  when L ≠ 0
         z = ln(X/M) / S              when L = 0
Supports prematurity correction (subtract missed weeks from age until 24 months).
"""

from __future__ import annotations
import math
from typing import Optional

# ── WHO LMS reference tables (subset: 0-60 months, key = age_months) ──
# Source: WHO Multicentre Growth Reference Study (2006)
# Format: {age_months: (L, M, S)}

# Weight-for-age (WAZ) — Boys
WAZ_BOYS: dict[int, tuple[float, float, float]] = {
    0:  (-0.3521, 3.3464, 0.14602),
    1:  (-0.1524, 4.4709, 0.13395),
    2:  ( 0.0196, 5.5675, 0.12385),
    3:  ( 0.1027, 6.3762, 0.11727),
    4:  ( 0.1402, 6.9873, 0.11316),
    5:  ( 0.1528, 7.4327, 0.11080),
    6:  ( 0.1539, 7.7934, 0.10958),
    7:  ( 0.1484, 8.0926, 0.10902),
    8:  ( 0.1400, 8.3553, 0.10882),
    9:  ( 0.1301, 8.5875, 0.10881),
    10: ( 0.1193, 8.7990, 0.10891),
    11: ( 0.1081, 8.9920, 0.10906),
    12: ( 0.0969, 9.1699, 0.10925),
    13: ( 0.0858, 9.3370, 0.10949),
    14: ( 0.0749, 9.4960, 0.10976),
    15: ( 0.0644, 9.6489, 0.11007),
    16: ( 0.0543, 9.7974, 0.11041),
    17: ( 0.0447, 9.9429, 0.11079),
    18: ( 0.0356, 10.0869, 0.11119),
    19: ( 0.0270, 10.2300, 0.11164),
    20: ( 0.0190, 10.3734, 0.11211),
    21: ( 0.0115, 10.5176, 0.11261),
    22: ( 0.0046, 10.6624, 0.11314),
    23: (-0.0018, 10.8076, 0.11369),
    24: (-0.0077, 10.9537, 0.11426),
    30: (-0.0312, 11.6934, 0.11725),
    36: (-0.0440, 12.4741, 0.12051),
    42: (-0.0494, 13.2886, 0.12394),
    48: (-0.0506, 14.1355, 0.12750),
    54: (-0.0498, 15.0146, 0.13110),
    60: (-0.0480, 15.9261, 0.13467),
}

# Weight-for-age (WAZ) — Girls
WAZ_GIRLS: dict[int, tuple[float, float, float]] = {
    0:  (-0.3833, 3.2322, 0.14171),
    1:  (-0.0744, 4.1873, 0.13724),
    2:  ( 0.1239, 5.1282, 0.13000),
    3:  ( 0.2104, 5.8458, 0.12619),
    4:  ( 0.2371, 6.4237, 0.12402),
    5:  ( 0.2334, 6.8985, 0.12274),
    6:  ( 0.2171, 7.2970, 0.12204),
    7:  ( 0.1952, 7.6422, 0.12166),
    8:  ( 0.1714, 7.9487, 0.12150),
    9:  ( 0.1474, 8.2254, 0.12152),
    10: ( 0.1240, 8.4800, 0.12166),
    11: ( 0.1018, 8.7148, 0.12190),
    12: ( 0.0808, 8.9327, 0.12221),
    13: ( 0.0613, 9.1385, 0.12260),
    14: ( 0.0432, 9.3362, 0.12304),
    15: ( 0.0263, 9.5273, 0.12355),
    16: ( 0.0107, 9.7131, 0.12410),
    17: (-0.0038, 9.8950, 0.12471),
    18: (-0.0172, 10.0740, 0.12536),
    19: (-0.0297, 10.2510, 0.12604),
    20: (-0.0413, 10.4270, 0.12676),
    21: (-0.0522, 10.6030, 0.12750),
    22: (-0.0624, 10.7790, 0.12828),
    23: (-0.0720, 10.9560, 0.12907),
    24: (-0.0809, 11.1340, 0.12989),
    30: (-0.1137, 11.9180, 0.13399),
    36: (-0.1332, 12.7440, 0.13830),
    42: (-0.1436, 13.6140, 0.14271),
    48: (-0.1481, 14.5340, 0.14714),
    54: (-0.1493, 15.5090, 0.15145),
    60: (-0.1487, 16.5440, 0.15551),
}

# Height/Length-for-age (HAZ) — Boys
HAZ_BOYS: dict[int, tuple[float, float, float]] = {
    0:  ( 1.0000, 49.8842, 0.03795),
    1:  ( 1.0000, 54.7244, 0.03557),
    2:  ( 1.0000, 58.4249, 0.03424),
    3:  ( 1.0000, 61.4292, 0.03328),
    4:  ( 1.0000, 63.8860, 0.03257),
    5:  ( 1.0000, 65.9026, 0.03204),
    6:  ( 1.0000, 67.6236, 0.03165),
    7:  ( 1.0000, 69.1645, 0.03139),
    8:  ( 1.0000, 70.5994, 0.03124),
    9:  ( 1.0000, 71.9687, 0.03117),
    10: ( 1.0000, 73.2812, 0.03118),
    11: ( 1.0000, 74.5388, 0.03126),
    12: ( 1.0000, 75.7488, 0.03141),
    13: ( 1.0000, 76.9186, 0.03161),
    14: ( 1.0000, 78.0497, 0.03186),
    15: ( 1.0000, 79.1458, 0.03213),
    16: ( 1.0000, 80.2113, 0.03243),
    17: ( 1.0000, 81.2487, 0.03275),
    18: ( 1.0000, 82.2587, 0.03309),
    19: ( 1.0000, 83.2418, 0.03344),
    20: ( 1.0000, 84.1996, 0.03380),
    21: ( 1.0000, 85.1348, 0.03416),
    22: ( 1.0000, 86.0477, 0.03453),
    23: ( 1.0000, 86.9410, 0.03490),
    24: ( 1.0000, 87.8161, 0.03527),
    30: ( 1.0000, 91.9096, 0.03714),
    36: ( 1.0000, 95.7541, 0.03901),
    42: ( 1.0000, 99.3442, 0.04080),
    48: ( 1.0000, 102.8516, 0.04245),
    54: ( 1.0000, 106.3369, 0.04389),
    60: ( 1.0000, 109.8560, 0.04508),
}

# Height/Length-for-age (HAZ) — Girls
HAZ_GIRLS: dict[int, tuple[float, float, float]] = {
    0:  ( 1.0000, 49.1477, 0.03790),
    1:  ( 1.0000, 53.6872, 0.03614),
    2:  ( 1.0000, 57.0673, 0.03568),
    3:  ( 1.0000, 59.8029, 0.03520),
    4:  ( 1.0000, 62.0899, 0.03486),
    5:  ( 1.0000, 64.0301, 0.03463),
    6:  ( 1.0000, 65.7311, 0.03448),
    7:  ( 1.0000, 67.2873, 0.03441),
    8:  ( 1.0000, 68.7498, 0.03440),
    9:  ( 1.0000, 70.1435, 0.03444),
    10: ( 1.0000, 71.4818, 0.03452),
    11: ( 1.0000, 72.7710, 0.03464),
    12: ( 1.0000, 74.0153, 0.03479),
    13: ( 1.0000, 75.2188, 0.03496),
    14: ( 1.0000, 76.3817, 0.03514),
    15: ( 1.0000, 77.5064, 0.03534),
    16: ( 1.0000, 78.5956, 0.03555),
    17: ( 1.0000, 79.6515, 0.03576),
    18: ( 1.0000, 80.6762, 0.03598),
    19: ( 1.0000, 81.6715, 0.03621),
    20: ( 1.0000, 82.6394, 0.03643),
    21: ( 1.0000, 83.5817, 0.03666),
    22: ( 1.0000, 84.4997, 0.03690),
    23: ( 1.0000, 85.3950, 0.03713),
    24: ( 1.0000, 86.2693, 0.03737),
    30: ( 1.0000, 90.2597, 0.03858),
    36: ( 1.0000, 94.1136, 0.03978),
    42: ( 1.0000, 97.8282, 0.04097),
    48: ( 1.0000, 101.5936, 0.04213),
    54: ( 1.0000, 105.4669, 0.04328),
    60: ( 1.0000, 109.4366, 0.04441),
}

# Weight-for-height (WHZ) — Boys (key = height_cm, rounded to nearest integer)
WHZ_BOYS: dict[int, tuple[float, float, float]] = {
    45: (-0.3521, 2.4410, 0.09182),
    50: (-0.0631, 3.3700, 0.09271),
    55: ( 0.2024, 4.5430, 0.09060),
    60: ( 0.2693, 5.8670, 0.08960),
    65: ( 0.2040, 7.2260, 0.09040),
    70: ( 0.1390, 8.4290, 0.09120),
    75: ( 0.0750, 9.4780, 0.09210),
    80: ( 0.0120, 10.4080, 0.09330),
    85: (-0.0490, 11.2720, 0.09520),
    90: (-0.1060, 12.1380, 0.09780),
    95: (-0.1580, 13.0550, 0.10100),
    100:(-0.2030, 14.0430, 0.10470),
    105:(-0.2400, 15.1130, 0.10870),
    110:(-0.2680, 16.2660, 0.11280),
    115:(-0.2860, 17.5170, 0.11680),
    120:(-0.2940, 18.8830, 0.12050),
}

# Weight-for-height (WHZ) — Girls
WHZ_GIRLS: dict[int, tuple[float, float, float]] = {
    45: (-0.3833, 2.4607, 0.09029),
    50: ( 0.0350, 3.2960, 0.09201),
    55: ( 0.2450, 4.3690, 0.09130),
    60: ( 0.2700, 5.5950, 0.09020),
    65: ( 0.1770, 6.8700, 0.09160),
    70: ( 0.0990, 8.0140, 0.09350),
    75: ( 0.0290, 9.0380, 0.09560),
    80: (-0.0380, 9.9600, 0.09810),
    85: (-0.1020, 10.8420, 0.10100),
    90: (-0.1620, 11.7440, 0.10440),
    95: (-0.2170, 12.7130, 0.10830),
    100:(-0.2650, 13.7680, 0.11260),
    105:(-0.3050, 14.9170, 0.11710),
    110:(-0.3370, 16.1700, 0.12150),
    115:(-0.3590, 17.5400, 0.12570),
    120:(-0.3720, 19.0320, 0.12940),
}


def _interpolate_lms(
    table: dict[int, tuple[float, float, float]],
    key: float,
) -> tuple[float, float, float]:
    """Linear interpolation between two nearest reference points."""
    keys = sorted(table.keys())

    if key <= keys[0]:
        return table[keys[0]]
    if key >= keys[-1]:
        return table[keys[-1]]

    # Find bracketing keys
    lower = keys[0]
    upper = keys[-1]
    for k in keys:
        if k <= key:
            lower = k
        if k >= key:
            upper = k
            break

    if lower == upper:
        return table[lower]

    frac = (key - lower) / (upper - lower)
    l_lms = table[lower]
    u_lms = table[upper]

    L = l_lms[0] + frac * (u_lms[0] - l_lms[0])
    M = l_lms[1] + frac * (u_lms[1] - l_lms[1])
    S = l_lms[2] + frac * (u_lms[2] - l_lms[2])
    return (L, M, S)


def _compute_zscore(x: float, L: float, M: float, S: float) -> float:
    """
    WHO z-score formula:
        z = [(X/M)^L - 1] / (L × S)   when L ≠ 0
        z = ln(X/M) / S                when L = 0
    """
    if M <= 0 or S <= 0 or x <= 0:
        return 0.0
    if abs(L) < 1e-10:
        return math.log(x / M) / S
    return ((x / M) ** L - 1) / (L * S)


def _correct_age_for_prematurity(
    age_months: float,
    gestational_weeks: Optional[int],
) -> float:
    """
    Subtract missed weeks from chronological age.
    Only apply correction until 24 months chronological age.
    Full-term = 40 weeks.
    """
    if gestational_weeks is None or gestational_weeks >= 37:
        return age_months
    if age_months > 24:
        return age_months
    missed_weeks = 40 - gestational_weeks
    correction_months = missed_weeks * (30.44 / 7) / 30.44  # weeks → months
    corrected = age_months - correction_months
    return max(0, corrected)


def compute_who_zscores(
    age_months: float,
    gender: str,
    weight_kg: float,
    height_cm: float,
    gestational_weeks: Optional[int] = None,
) -> dict:
    """
    Compute WAZ, HAZ, WHZ z-scores and classify nutrition risk.

    Args:
        age_months: Chronological age in months (0-60)
        gender: 'M' or 'F'
        weight_kg: Weight in kilograms
        height_cm: Height/length in centimeters
        gestational_weeks: Gestational age at birth (for prematurity correction)

    Returns:
        dict with keys: waz, haz, whz, who_nutrition_risk
    """
    corrected_age = _correct_age_for_prematurity(age_months, gestational_weeks)

    is_male = gender.upper().startswith('M')

    # WAZ
    waz_table = WAZ_BOYS if is_male else WAZ_GIRLS
    L, M, S = _interpolate_lms(waz_table, corrected_age)
    waz = _compute_zscore(weight_kg, L, M, S)

    # HAZ
    haz_table = HAZ_BOYS if is_male else HAZ_GIRLS
    L, M, S = _interpolate_lms(haz_table, corrected_age)
    haz = _compute_zscore(height_cm, L, M, S)

    # WHZ (keyed by height)
    whz_table = WHZ_BOYS if is_male else WHZ_GIRLS
    L, M, S = _interpolate_lms(whz_table, height_cm)
    whz = _compute_zscore(weight_kg, L, M, S)

    # Clamp extreme values
    waz = max(-6.0, min(6.0, waz))
    haz = max(-6.0, min(6.0, haz))
    whz = max(-6.0, min(6.0, whz))

    # Classify nutrition risk based on WAZ
    if waz < -3:
        who_nutrition_risk = "Severely Underweight"
    elif waz < -2:
        who_nutrition_risk = "Underweight"
    elif waz < -1:
        who_nutrition_risk = "At Risk"
    else:
        who_nutrition_risk = "Normal"

    return {
        "waz": round(waz, 2),
        "haz": round(haz, 2),
        "whz": round(whz, 2),
        "who_nutrition_risk": who_nutrition_risk,
    }

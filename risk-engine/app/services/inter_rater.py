"""
ECD Risk Engine — Inter-Rater Reliability (IRR) Service
Measures consistency between different AWWs (Anganwadi Workers)
assessing the same children.

Computes Cohen's kappa for categorical agreement on risk classifications,
ICC(2,1) for continuous DQ score consistency, and percentage agreement
for binary delay flags.

References:
    Cohen, J. (1960) "A Coefficient of Agreement for Nominal Scales"
    Shrout, P.E. & Fleiss, J.L. (1979) "Intraclass Correlations"
    Bland, J.M. & Altman, D.G. (1986) "Statistical Methods for Assessing
        Agreement Between Two Methods of Clinical Measurement"
"""

from __future__ import annotations

from collections import defaultdict
from typing import Optional

from pydantic import BaseModel, Field


# ── Domain keys ──
DOMAIN_KEYS = ["gm", "fm", "lc", "cog", "se"]

# ── Kappa interpretation thresholds (Landis & Koch, 1977) ──
KAPPA_THRESHOLDS = [
    (0.20, "Poor"),
    (0.40, "Fair"),
    (0.60, "Moderate"),
    (0.80, "Substantial"),
    (1.01, "Almost Perfect"),  # 1.01 so that 1.0 falls into this bucket
]


def interpret_kappa(kappa: float) -> str:
    """Return a qualitative label for a Cohen's kappa value."""
    if kappa < 0.0:
        return "Poor"
    for threshold, label in KAPPA_THRESHOLDS:
        if kappa < threshold:
            return label
    return "Almost Perfect"


# ── Pydantic models ──

class RaterAssessment(BaseModel):
    """A single rater's assessment of one child."""
    rater_id: str
    child_id: str
    assessment_date: str
    domain_dqs: dict[str, float] = Field(
        ...,
        description="Development quotient per domain (gm, fm, lc, cog, se)",
    )
    delay_flags: dict[str, int] = Field(
        ...,
        description="Binary delay flags per domain (0 = no delay, 1 = delay)",
    )
    risk_category: str = Field(
        ...,
        description="Overall risk classification: Low, Medium, or High",
    )


class BlandAltmanStats(BaseModel):
    """Bland-Altman agreement statistics for a single domain."""
    mean_diff: float = Field(description="Mean of differences (bias)")
    std_diff: float = Field(description="Standard deviation of differences")
    lower_loa: float = Field(description="Lower limit of agreement (mean - 1.96*SD)")
    upper_loa: float = Field(description="Upper limit of agreement (mean + 1.96*SD)")


class IRRResult(BaseModel):
    """Comprehensive inter-rater reliability results."""
    n_children_paired: int = Field(
        description="Number of children assessed by exactly 2 raters",
    )
    cohens_kappa_per_domain: dict[str, float] = Field(
        default_factory=dict,
        description="Cohen's kappa for delay flags per domain",
    )
    overall_kappa: float = Field(
        description="Cohen's kappa for overall risk_category",
    )
    kappa_interpretation: str = Field(
        description="Qualitative interpretation of overall kappa",
    )
    icc_per_domain: dict[str, float] = Field(
        default_factory=dict,
        description="ICC(2,1) for DQ scores per domain",
    )
    pct_agreement_per_domain: dict[str, float] = Field(
        default_factory=dict,
        description="Percentage agreement for delay flags per domain",
    )
    pct_agreement_overall: float = Field(
        description="Percentage agreement for overall risk_category",
    )
    bland_altman: dict[str, BlandAltmanStats] = Field(
        default_factory=dict,
        description="Bland-Altman statistics per domain",
    )


# ── Core statistical functions ──

def compute_cohens_kappa(
    rater1_categories: list[str],
    rater2_categories: list[str],
) -> float:
    """
    Compute Cohen's kappa for two raters' categorical classifications.

    Uses the standard formula:
        kappa = (p_o - p_e) / (1 - p_e)
    where p_o is observed agreement and p_e is expected agreement by chance.

    Categories are expected to be "Low", "Medium", or "High".

    Args:
        rater1_categories: List of category labels from rater 1.
        rater2_categories: List of category labels from rater 2.

    Returns:
        Cohen's kappa coefficient in [-1, 1].  Returns 1.0 when all
        ratings agree (avoiding 0/0).
    """
    n = len(rater1_categories)
    if n == 0:
        return 0.0
    if n != len(rater2_categories):
        raise ValueError("Both rater lists must have the same length.")

    # Collect the full set of categories present
    all_categories = sorted(set(rater1_categories) | set(rater2_categories))

    # Build the confusion matrix
    matrix: dict[str, dict[str, int]] = {
        c1: {c2: 0 for c2 in all_categories} for c1 in all_categories
    }
    for r1, r2 in zip(rater1_categories, rater2_categories):
        matrix[r1][r2] += 1

    # Observed agreement
    p_o = sum(matrix[c][c] for c in all_categories) / n

    # Expected agreement by chance
    p_e = 0.0
    for c in all_categories:
        row_total = sum(matrix[c][c2] for c2 in all_categories)
        col_total = sum(matrix[c1][c] for c1 in all_categories)
        p_e += (row_total / n) * (col_total / n)

    # Edge case: perfect agreement (p_e == 1.0 means 0/0)
    if abs(1.0 - p_e) < 1e-12:
        return 1.0

    kappa = (p_o - p_e) / (1.0 - p_e)
    return round(kappa, 4)


def compute_icc(measurements: list[list[float]]) -> float:
    """
    Compute ICC(2,1) — two-way random, single measures, absolute agreement.

    Uses ANOVA-based decomposition without external libraries.

    The model:
        x_ij = mu + r_i + c_j + e_ij
    where r_i is the subject (child) effect and c_j is the rater effect.

    ICC(2,1) = (MS_R - MS_E) / (MS_R + (k-1)*MS_E + k*(MS_C - MS_E)/n)

    Args:
        measurements: List of [rater1_score, rater2_score] pairs.

    Returns:
        ICC coefficient in [-1, 1].  Returns 0.0 for degenerate inputs.
    """
    n = len(measurements)  # number of subjects
    if n < 2:
        return 0.0

    k = 2  # number of raters (always pairs)

    # Grand mean
    total = 0.0
    for pair in measurements:
        for val in pair:
            total += val
    grand_mean = total / (n * k)

    # Row means (per subject)
    row_means = [(pair[0] + pair[1]) / k for pair in measurements]

    # Column means (per rater)
    col_means = [
        sum(pair[j] for pair in measurements) / n for j in range(k)
    ]

    # Sum of squares — between subjects (rows)
    ss_r = k * sum((rm - grand_mean) ** 2 for rm in row_means)

    # Sum of squares — between raters (columns)
    ss_c = n * sum((cm - grand_mean) ** 2 for cm in col_means)

    # Total sum of squares
    ss_total = sum(
        (pair[j] - grand_mean) ** 2
        for pair in measurements
        for j in range(k)
    )

    # Residual (error) sum of squares
    ss_e = ss_total - ss_r - ss_c

    # Degrees of freedom
    df_r = n - 1
    df_c = k - 1
    df_e = (n - 1) * (k - 1)

    if df_r == 0 or df_e == 0:
        return 0.0

    # Mean squares
    ms_r = ss_r / df_r
    ms_c = ss_c / df_c if df_c > 0 else 0.0
    ms_e = ss_e / df_e

    # ICC(2,1)
    denominator = ms_r + (k - 1) * ms_e + k * (ms_c - ms_e) / n
    if abs(denominator) < 1e-12:
        return 0.0

    icc = (ms_r - ms_e) / denominator
    return round(max(-1.0, min(1.0, icc)), 4)


def _compute_bland_altman(pairs: list[tuple[float, float]]) -> BlandAltmanStats:
    """
    Compute Bland-Altman statistics for a set of measurement pairs.

    Args:
        pairs: List of (rater1_score, rater2_score) tuples.

    Returns:
        BlandAltmanStats with bias and limits of agreement.
    """
    n = len(pairs)
    if n == 0:
        return BlandAltmanStats(
            mean_diff=0.0, std_diff=0.0, lower_loa=0.0, upper_loa=0.0,
        )

    diffs = [a - b for a, b in pairs]
    mean_diff = sum(diffs) / n

    if n < 2:
        return BlandAltmanStats(
            mean_diff=round(mean_diff, 4),
            std_diff=0.0,
            lower_loa=round(mean_diff, 4),
            upper_loa=round(mean_diff, 4),
        )

    # Sample standard deviation
    variance = sum((d - mean_diff) ** 2 for d in diffs) / (n - 1)
    std_diff = variance ** 0.5

    lower_loa = mean_diff - 1.96 * std_diff
    upper_loa = mean_diff + 1.96 * std_diff

    return BlandAltmanStats(
        mean_diff=round(mean_diff, 4),
        std_diff=round(std_diff, 4),
        lower_loa=round(lower_loa, 4),
        upper_loa=round(upper_loa, 4),
    )


# ── Main IRR computation ──

def compute_irr(assessments: list[RaterAssessment]) -> IRRResult:
    """
    Compute comprehensive inter-rater reliability from a batch of assessments.

    Assessments are grouped by child_id.  For each child assessed by exactly
    two raters, pairwise agreement metrics are computed:
        - Cohen's kappa for risk_category and per-domain delay flags
        - ICC(2,1) for continuous DQ scores per domain
        - Percentage agreement for delay flags and risk category
        - Bland-Altman bias and limits of agreement for DQ scores

    Args:
        assessments: List of RaterAssessment objects (multiple raters per child).

    Returns:
        IRRResult with all computed reliability statistics.
    """
    # Group by child_id
    by_child: dict[str, list[RaterAssessment]] = defaultdict(list)
    for a in assessments:
        by_child[a.child_id].append(a)

    # Keep only children with exactly 2 raters
    paired: dict[str, list[RaterAssessment]] = {
        cid: raters for cid, raters in by_child.items() if len(raters) == 2
    }

    n_paired = len(paired)

    if n_paired == 0:
        return IRRResult(
            n_children_paired=0,
            cohens_kappa_per_domain={},
            overall_kappa=0.0,
            kappa_interpretation=interpret_kappa(0.0),
            icc_per_domain={},
            pct_agreement_per_domain={},
            pct_agreement_overall=0.0,
            bland_altman={},
        )

    # Collect paired data
    rater1_risk: list[str] = []
    rater2_risk: list[str] = []
    domain_dq_pairs: dict[str, list[list[float]]] = {d: [] for d in DOMAIN_KEYS}
    domain_flag_r1: dict[str, list[str]] = {d: [] for d in DOMAIN_KEYS}
    domain_flag_r2: dict[str, list[str]] = {d: [] for d in DOMAIN_KEYS}
    domain_ba_pairs: dict[str, list[tuple[float, float]]] = {d: [] for d in DOMAIN_KEYS}

    for cid, raters in paired.items():
        r1, r2 = raters[0], raters[1]

        # Risk category
        rater1_risk.append(r1.risk_category)
        rater2_risk.append(r2.risk_category)

        # Per-domain data
        for domain in DOMAIN_KEYS:
            # DQ scores for ICC and Bland-Altman
            dq1 = r1.domain_dqs.get(domain, 0.0)
            dq2 = r2.domain_dqs.get(domain, 0.0)
            domain_dq_pairs[domain].append([dq1, dq2])
            domain_ba_pairs[domain].append((dq1, dq2))

            # Delay flags as categories for kappa
            flag1 = str(r1.delay_flags.get(domain, 0))
            flag2 = str(r2.delay_flags.get(domain, 0))
            domain_flag_r1[domain].append(flag1)
            domain_flag_r2[domain].append(flag2)

    # Overall kappa for risk category
    overall_kappa = compute_cohens_kappa(rater1_risk, rater2_risk)

    # Per-domain kappa for delay flags
    kappa_per_domain: dict[str, float] = {}
    for domain in DOMAIN_KEYS:
        kappa_per_domain[domain] = compute_cohens_kappa(
            domain_flag_r1[domain], domain_flag_r2[domain],
        )

    # ICC per domain
    icc_per_domain: dict[str, float] = {}
    for domain in DOMAIN_KEYS:
        icc_per_domain[domain] = compute_icc(domain_dq_pairs[domain])

    # Percentage agreement for delay flags
    pct_agreement_domain: dict[str, float] = {}
    for domain in DOMAIN_KEYS:
        agreements = sum(
            1 for f1, f2 in zip(domain_flag_r1[domain], domain_flag_r2[domain])
            if f1 == f2
        )
        pct_agreement_domain[domain] = round(agreements / n_paired * 100, 2)

    # Percentage agreement for risk category
    risk_agreements = sum(
        1 for r1, r2 in zip(rater1_risk, rater2_risk) if r1 == r2
    )
    pct_agreement_overall = round(risk_agreements / n_paired * 100, 2)

    # Bland-Altman per domain
    bland_altman: dict[str, BlandAltmanStats] = {}
    for domain in DOMAIN_KEYS:
        bland_altman[domain] = _compute_bland_altman(domain_ba_pairs[domain])

    return IRRResult(
        n_children_paired=n_paired,
        cohens_kappa_per_domain=kappa_per_domain,
        overall_kappa=overall_kappa,
        kappa_interpretation=interpret_kappa(overall_kappa),
        icc_per_domain=icc_per_domain,
        pct_agreement_per_domain=pct_agreement_domain,
        pct_agreement_overall=pct_agreement_overall,
        bland_altman=bland_altman,
    )

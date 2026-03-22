// ECD Intelligence System — TypeScript Type Definitions
// Mirrors the JSON output from the data pipeline

export interface Child {
    child_id: string;
    dob: string;
    age_months: number;
    gender: string;
    awc_code: number;
    mandal: string;
    district: string;
    assessment_cycle: string;
    // Developmental delays
    gm_delay: number;
    fm_delay: number;
    lc_delay: number;
    cog_delay: number;
    se_delay: number;
    num_delays: number;
    // Neuro-behavioral
    autism_risk: string;
    adhd_risk: string;
    behavior_risk: string;
    // Nutrition
    underweight: number;
    stunting: number;
    wasting: number;
    anemia: number;
    nutrition_score: number;
    nutrition_risk: string;
    // Environment
    parent_child_interaction_score: number;
    parent_mental_health_score: number;
    home_stimulation_score: number;
    play_materials: string;
    caregiver_engagement: string;
    language_exposure: string;
    safe_water: string;
    toilet_facility: string;
    // DQ scores
    mode_delivery: string;
    mode_conception: string;
    birth_status: string;
    consanguinity: string;
    gm_dq: number;
    fm_dq: number;
    lc_dq: number;
    cog_dq: number;
    se_dq: number;
    composite_dq: number;
    // Z-scores
    gm_dq_zscore: number;
    fm_dq_zscore: number;
    lc_dq_zscore: number;
    cog_dq_zscore: number;
    se_dq_zscore: number;
    composite_dq_zscore: number;
    // Risk classification
    developmental_status: string;
    risk_autism_class: string;
    attention_regulation_risk: string;
    nutrition_linked_risk: string;
    // Behaviour
    behaviour_concerns: string;
    behaviour_score: number;
    behaviour_risk_level: string;
    // Baseline risk
    baseline_score: number;
    baseline_category: string;
    // Referral
    referral_triggered: string;
    referral_type: string;
    referral_reason: string;
    referral_status: string;
    // Intervention
    intervention_plan_generated: string;
    home_activities_assigned: number;
    followup_conducted: string;
    improvement_status: string;
    // Outcomes
    reduction_in_delay_months: number;
    domain_improvement: string;
    autism_risk_change: string;
    exit_high_risk: string;
    // Computed
    computed_risk_score: number;
    computed_risk_category: string;
    risk_confidence: number;
    // Demographic fields for bias auditing
    social_category?: string;
    maternal_education?: string;
    paternal_education?: string;
    household_income_band?: string;
    ration_card_type?: string;
}

export interface ContributingDomain {
    domain: string;
    points: number;
    reason: string;
}

export interface RiskScore {
    child_id: string;
    risk_score: number;
    risk_category: string;
    confidence: number;
    contributing_domains: ContributingDomain[];
    composite_dq: number;
    composite_dq_zscore: number;
}

export interface Alert {
    alert_id: string;
    child_id: string | null;
    domain: string;
    indicator: string;
    severity: string;
    confidence: number;
    dq_value: number | null;
    message: string;
    suggested_action: string;
}

export interface InterventionPlan {
    domain: string;
    activity: string;
    frequency: string;
    duration_minutes: number;
    caregiver_format: string;
    priority: number;
    rationale: string;
}

export interface ChildIntervention {
    child_id: string;
    total_interventions: number;
    plans: InterventionPlan[];
    referral_type: string;
    referral_status: string;
    improvement_status: string;
}

export interface MandalAnalytics {
    mandal: string;
    total: number;
    high_risk: number;
    medium_risk: number;
    low_risk: number;
    avg_composite_dq: number;
    referral_pending: number;
    intervention_active: number;
    improved: number;
}

export interface DistrictAnalytics {
    district: string;
    total: number;
    high_risk: number;
    medium_risk: number;
    low_risk: number;
}

export interface AWCAnalytics {
    awc_code: number;
    mandal: string;
    district: string;
    total_children: number;
    impact_score: number;
    improved: number;
    followup_rate: number;
}

export interface EngagementMetrics {
    avg_parent_interaction: number;
    avg_home_stimulation: number;
    play_materials_pct: number;
    adequate_language_pct: number;
    safe_water_pct: number;
    toilet_facility_pct: number;
    followup_rate: number;
    home_activity_completion: number;
}

export interface FieldPerformance {
    visit_compliance: number;
    intervention_coverage: number;
    referral_completion: number;
    risk_closure_rate: number;
}

export interface KPI {
    total_children: number;
    high_risk: number;
    medium_risk: number;
    low_risk: number;
    intervention_active: number;
    followup_done: number;
    improved: number;
    high_risk_pct: number;
    medium_risk_pct: number;
    low_risk_pct: number;
}

export interface Analytics {
    kpi: KPI;
    mandals: MandalAnalytics[];
    districts: DistrictAnalytics[];
    top_awc: AWCAnalytics[];
    engagement: EngagementMetrics;
    field_performance: FieldPerformance;
}

export interface RiskTrendPoint {
    month: string;
    high_risk_pct: number;
    medium_risk_pct: number;
    low_risk_pct: number;
}

export interface DomainTrajectoryPoint {
    month: string;
    [domain: string]: string | number;
}

export interface InterventionComparisonPoint {
    month: string;
    with_intervention: number;
    without_intervention: number;
}

export interface CohortAnalytics {
    improved_pct: number;
    same_pct: number;
    worsened_pct: number;
    avg_delay_reduction_months: number;
    domain_improvement_pct: number;
    exit_high_risk_pct: number;
}

export interface LongitudinalData {
    risk_trend: RiskTrendPoint[];
    domain_trajectory: DomainTrajectoryPoint[];
    intervention_comparison: InterventionComparisonPoint[];
    cohort_analytics: CohortAnalytics;
}

export type RoleType = "AWW Worker" | "Supervisor" | "CDPO" | "State Admin";

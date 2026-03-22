-- Add demographic fields for bias auditing
ALTER TABLE "children" ADD COLUMN IF NOT EXISTS "social_category" VARCHAR(30);
ALTER TABLE "children" ADD COLUMN IF NOT EXISTS "maternal_education" VARCHAR(50);
ALTER TABLE "children" ADD COLUMN IF NOT EXISTS "paternal_education" VARCHAR(50);
ALTER TABLE "children" ADD COLUMN IF NOT EXISTS "household_income_band" VARCHAR(30);
ALTER TABLE "children" ADD COLUMN IF NOT EXISTS "ration_card_type" VARCHAR(30);

-- Add v2 environmental risk factors to assessments
ALTER TABLE "assessments" ADD COLUMN IF NOT EXISTS "home_stimulation_score" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "assessments" ADD COLUMN IF NOT EXISTS "parent_mental_health_score" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "assessments" ADD COLUMN IF NOT EXISTS "caregiver_engagement" VARCHAR(20);
ALTER TABLE "assessments" ADD COLUMN IF NOT EXISTS "language_exposure" VARCHAR(30);

-- Add v2 dual scoring fields to risk_profiles
ALTER TABLE "risk_profiles" ADD COLUMN IF NOT EXISTS "old_score" INTEGER;
ALTER TABLE "risk_profiles" ADD COLUMN IF NOT EXISTS "old_category" VARCHAR(20);
ALTER TABLE "risk_profiles" ADD COLUMN IF NOT EXISTS "formula_version" VARCHAR(30) NOT NULL DEFAULT 'v2_recalibrated';
ALTER TABLE "risk_profiles" ADD COLUMN IF NOT EXISTS "active_formula" VARCHAR(10) NOT NULL DEFAULT 'v1';
ALTER TABLE "risk_profiles" ADD COLUMN IF NOT EXISTS "waz" DECIMAL(5,2);
ALTER TABLE "risk_profiles" ADD COLUMN IF NOT EXISTS "haz" DECIMAL(5,2);
ALTER TABLE "risk_profiles" ADD COLUMN IF NOT EXISTS "whz" DECIMAL(5,2);
ALTER TABLE "risk_profiles" ADD COLUMN IF NOT EXISTS "muac_zscore" DECIMAL(5,2);
ALTER TABLE "risk_profiles" ADD COLUMN IF NOT EXISTS "who_nutrition_risk" VARCHAR(30);

-- Add WHO fields to growth_records
ALTER TABLE "growth_records" ADD COLUMN IF NOT EXISTS "muac_zscore" DECIMAL(5,2);
ALTER TABLE "growth_records" ADD COLUMN IF NOT EXISTS "who_nutrition_risk" VARCHAR(30);

-- M-CHAT Assessments (Task 5)
CREATE TABLE IF NOT EXISTS "mchat_assessments" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "child_id" VARCHAR(50) NOT NULL,
    "assessment_id" UUID,
    "item_responses" JSONB NOT NULL,
    "total_score" INTEGER NOT NULL,
    "critical_fails" INTEGER NOT NULL,
    "risk_level" VARCHAR(20) NOT NULL,
    "followup_required" BOOLEAN NOT NULL DEFAULT false,
    "followup_conducted" BOOLEAN NOT NULL DEFAULT false,
    "followup_score" INTEGER,
    "followup_risk_level" VARCHAR(20),
    "assessed_at" TIMESTAMPTZ NOT NULL,
    "assessor_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "idx_mchat_child_id" ON "mchat_assessments"("child_id");

-- Bias Audit Log (Task 6)
CREATE TABLE IF NOT EXISTS "bias_audit_logs" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "audit_date" DATE NOT NULL,
    "subgroup_type" VARCHAR(50) NOT NULL,
    "subgroup_value" VARCHAR(100) NOT NULL,
    "n_children" INTEGER NOT NULL,
    "n_at_risk" INTEGER NOT NULL,
    "sensitivity" DOUBLE PRECISION NOT NULL,
    "specificity" DOUBLE PRECISION,
    "deviation_from_overall" DOUBLE PRECISION NOT NULL,
    "alert_triggered" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- DEIC Outcomes (Task 7)
CREATE TABLE IF NOT EXISTS "deic_outcomes" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "child_id" VARCHAR(50) NOT NULL UNIQUE,
    "referral_id" UUID,
    "deic_assessment_date" DATE NOT NULL,
    "clinical_diagnosis" TEXT,
    "clinical_risk_level" VARCHAR(20) NOT NULL,
    "clinical_domains" TEXT[] NOT NULL DEFAULT '{}',
    "platform_score_at_referral" INTEGER NOT NULL,
    "platform_category_at_referral" VARCHAR(20) NOT NULL,
    "concordance" BOOLEAN NOT NULL,
    "false_negative" BOOLEAN NOT NULL DEFAULT false,
    "false_positive" BOOLEAN NOT NULL DEFAULT false,
    "entered_by" UUID NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Validation Claims (Task 7)
CREATE TABLE IF NOT EXISTS "validation_claims" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "claim" TEXT NOT NULL,
    "metric_value" DOUBLE PRECISION,
    "evidence_source" VARCHAR(50) NOT NULL,
    "sample_size" INTEGER NOT NULL,
    "confidence_level" VARCHAR(30) NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_until" DATE,
    "approved_by" UUID,
    "model_version" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Reliability Assessments (Task 8)
CREATE TABLE IF NOT EXISTS "reliability_assessments" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "child_id" VARCHAR(50) NOT NULL,
    "assessor1_id" UUID NOT NULL,
    "assessor2_id" UUID NOT NULL,
    "assessment1_id" UUID NOT NULL,
    "assessment2_id" UUID NOT NULL,
    "study_date" DATE NOT NULL,
    "domain_kappas" JSONB NOT NULL,
    "overall_kappa" DOUBLE PRECISION NOT NULL,
    "domain_iccs" JSONB NOT NULL,
    "agreement_pct" DOUBLE PRECISION NOT NULL,
    "kappa_grade" VARCHAR(20) NOT NULL,
    "requires_retraining" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Longitudinal Features (Task 9)
CREATE TABLE IF NOT EXISTS "longitudinal_features" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "child_id" VARCHAR(50) NOT NULL UNIQUE,
    "computed_at" TIMESTAMPTZ NOT NULL,
    "assessments_count" INTEGER NOT NULL,
    "months_tracked" DOUBLE PRECISION NOT NULL,
    "gm_dq_velocity" DOUBLE PRECISION,
    "fm_dq_velocity" DOUBLE PRECISION,
    "lc_dq_velocity" DOUBLE PRECISION,
    "cog_dq_velocity" DOUBLE PRECISION,
    "se_dq_velocity" DOUBLE PRECISION,
    "composite_dq_velocity" DOUBLE PRECISION,
    "stagnation_flag" BOOLEAN NOT NULL DEFAULT false,
    "regression_flag" BOOLEAN NOT NULL DEFAULT false,
    "acceleration_flag" BOOLEAN NOT NULL DEFAULT false,
    "engagement_improving" BOOLEAN,
    "last_assessment_id" UUID NOT NULL,
    "prior_assessment_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Seed initial validation claims
INSERT INTO "validation_claims" ("claim", "metric_value", "evidence_source", "sample_size", "confidence_level", "valid_from", "model_version")
VALUES
    ('Low risk detection accuracy: 98.0% recall', 98.0, 'cross_validation', 713, 'internal_only', CURRENT_DATE, 'rule_v2'),
    ('Medium risk detection accuracy: 71.3% recall', 71.3, 'cross_validation', 279, 'internal_only', CURRENT_DATE, 'rule_v2'),
    ('Overall accuracy: 88.8%', 88.8, 'cross_validation', 1000, 'internal_only', CURRENT_DATE, 'rule_v2'),
    ('HIGH risk sensitivity: 0% — insufficient data (N=8)', 0.0, 'cross_validation', 8, 'preliminary', CURRENT_DATE, 'rule_v2')
ON CONFLICT DO NOTHING;

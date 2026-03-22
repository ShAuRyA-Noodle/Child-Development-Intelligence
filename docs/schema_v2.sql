-- ==========================================================
-- Early Childhood Development (ECD) Intelligence Platform
-- Production PostgreSQL Schema — v2
-- ==========================================================
-- Extends v1 with: milestone tracking, growth monitoring,
-- offline-sync management, audit/compliance, content library,
-- caregiver engagement, intervention compliance, AI decision
-- logging, daily-task workflow, and notification delivery.
-- ==========================================================

BEGIN;

-- ==========================================
-- 1. ROLE-BASED ACCESS CONTROL (RBAC)
-- ==========================================

CREATE TYPE user_role AS ENUM ('AWW', 'Supervisor', 'CDPO', 'StateAdmin');

CREATE TABLE users (
    user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(150),
    role user_role NOT NULL,
    email VARCHAR(255) UNIQUE,
    phone VARCHAR(20),
    is_active BOOLEAN DEFAULT true,
    last_login TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE locations (
    location_id SERIAL PRIMARY KEY,
    level VARCHAR(50) CHECK (level IN ('State', 'District', 'Project', 'Sector', 'AWC')),
    parent_location_id INTEGER REFERENCES locations(location_id),
    name VARCHAR(150) NOT NULL,
    code VARCHAR(50) UNIQUE -- e.g., AWC code
);

-- Users mapped to locations (AWW -> AWC, CDPO -> Project)
CREATE TABLE user_locations (
    user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    location_id INTEGER REFERENCES locations(location_id) ON DELETE CASCADE,
    assignment_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, location_id)
);

-- ==========================================
-- 2. CORE REGISTRY (CHILD & CAREGIVERS)
-- ==========================================

CREATE TABLE caregivers (
    caregiver_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    primary_name VARCHAR(150) NOT NULL,
    relation VARCHAR(50), -- Mother, Father, Guardian
    contact_number VARCHAR(20),
    education_level VARCHAR(100),
    primary_language VARCHAR(50) DEFAULT 'Telugu',
    consent_given BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE children (
    child_id VARCHAR(50) PRIMARY KEY, -- e.g. "AP_ECD_1001"
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    gender VARCHAR(10) CHECK (gender IN ('M', 'F', 'O')),
    dob DATE NOT NULL,
    registration_date DATE DEFAULT CURRENT_DATE,
    birth_weight_kg DECIMAL(5,2),
    birth_status VARCHAR(50), -- Normal, Preterm, Low Birth Weight
    caregiver_id UUID REFERENCES caregivers(caregiver_id),
    awc_id INTEGER REFERENCES locations(location_id),
    is_active BOOLEAN DEFAULT true,
    -- Equity demographic fields (used ONLY for bias auditing, never for scoring)
    caste_category VARCHAR(20) CHECK (caste_category IN ('General', 'OBC', 'SC', 'ST')),
    religion VARCHAR(30),
    area_type VARCHAR(20) CHECK (area_type IN ('Urban', 'Rural', 'Tribal')),
    mother_education VARCHAR(30) CHECK (mother_education IN ('None', 'Primary', 'Secondary', 'Higher')),
    economic_category VARCHAR(10) CHECK (economic_category IN ('APL', 'BPL', 'AAY')),
    gestational_weeks INTEGER CHECK (gestational_weeks BETWEEN 20 AND 45),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 3. ASSESSMENT & SCORING MODULE
-- ==========================================

CREATE TABLE assessments (
    assessment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    child_id VARCHAR(50) REFERENCES children(child_id) ON DELETE CASCADE,
    assessor_id UUID REFERENCES users(user_id),
    assessment_date DATE NOT NULL,
    assessment_cycle VARCHAR(50), -- e.g. Base, Midline, Endline
    age_at_assessment_months INTEGER NOT NULL,

    -- Raw Metrics
    height_cm DECIMAL(5,2),
    weight_kg DECIMAL(5,2),
    muac_cm DECIMAL(5,2),

    -- Sub-domain DQ (Developmental Quotient) Scores
    gm_dq DECIMAL(6,2),
    fm_dq DECIMAL(6,2),
    lc_dq DECIMAL(6,2),
    cog_dq DECIMAL(6,2),
    se_dq DECIMAL(6,2),
    composite_dq DECIMAL(6,2),

    -- Assessor notes
    clinical_observations TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Derived table storing calculated risk scores to prevent
-- recomputation on every dashboard load
CREATE TABLE risk_profiles (
    risk_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    child_id VARCHAR(50) REFERENCES children(child_id) ON DELETE CASCADE,
    assessment_id UUID REFERENCES assessments(assessment_id),

    computed_risk_score DECIMAL(5,2) NOT NULL,
    risk_category VARCHAR(20) CHECK (risk_category IN ('Low', 'Medium', 'High')),
    confidence_score DECIMAL(5,2),
    num_delays INTEGER DEFAULT 0,

    -- Historical trend tracking
    improvement_status VARCHAR(50),
    reduction_in_delay_months INTEGER DEFAULT 0,

    calculation_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 4. ALERTS & INTELLIGENCE
-- ==========================================

CREATE TYPE severity_level AS ENUM ('critical', 'high', 'moderate', 'low');
CREATE TYPE alert_status  AS ENUM ('active', 'acknowledged', 'resolved');

CREATE TABLE intelligent_alerts (
    alert_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    child_id VARCHAR(50) REFERENCES children(child_id),
    domain VARCHAR(100) NOT NULL,
    indicator VARCHAR(200) NOT NULL,
    severity severity_level NOT NULL,
    confidence_pct INTEGER,
    message TEXT NOT NULL,
    status alert_status DEFAULT 'active',
    generated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolved_by UUID REFERENCES users(user_id)
);

-- ==========================================
-- 5. INTERVENTION PLAN ENGINE
-- ==========================================

CREATE TABLE intervention_plans (
    plan_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    child_id VARCHAR(50) REFERENCES children(child_id) ON DELETE CASCADE,
    generated_from_assessment_id UUID REFERENCES assessments(assessment_id),
    status VARCHAR(50) DEFAULT 'Draft', -- Draft, Active, Completed, Abandoned
    start_date DATE,
    end_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE plan_activities (
    activity_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id UUID REFERENCES intervention_plans(plan_id) ON DELETE CASCADE,
    domain VARCHAR(100) NOT NULL,
    activity_name VARCHAR(255) NOT NULL,
    frequency VARCHAR(100),
    duration_minutes INTEGER,
    caregiver_format VARCHAR(100), -- 1:1, Group, Home
    is_completed BOOLEAN DEFAULT false,
    completed_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE referrals (
    referral_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    child_id VARCHAR(50) REFERENCES children(child_id),
    referred_by UUID REFERENCES users(user_id),
    referral_type VARCHAR(100), -- RBSK, PHC, Nutrition Rehab Center
    reason TEXT NOT NULL,
    status VARCHAR(50) DEFAULT 'Pending', -- Pending, Seen, Treatment Active, Closed
    referral_date DATE DEFAULT CURRENT_DATE,
    followup_date DATE
);

-- ==========================================
-- 6. MILESTONE SYSTEM
-- ==========================================
-- Age-normed milestone reference data used by the assessment
-- engine to compare a child's progress against expected norms.

CREATE TABLE milestone_norms (
    milestone_id SERIAL PRIMARY KEY,
    domain VARCHAR(50) NOT NULL,           -- Gross Motor, Fine Motor, Language & Communication, Cognitive, Social-Emotional
    milestone_name VARCHAR(200) NOT NULL,
    expected_age_months_min INTEGER NOT NULL,
    expected_age_months_max INTEGER NOT NULL,
    assessment_method VARCHAR(100),        -- Observation, Caregiver Report, Direct Test
    age_band VARCHAR(20) NOT NULL          -- 0-6, 7-12, 13-18, 19-24, 25-36, 37-48, 49-60, 61-72
);

-- Individual child milestone achievements, linked back to the
-- assessment during which each milestone was observed or reported.
CREATE TABLE milestone_achievements (
    achievement_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    child_id VARCHAR(50) REFERENCES children(child_id) ON DELETE CASCADE,
    milestone_id INTEGER REFERENCES milestone_norms(milestone_id),
    assessment_id UUID REFERENCES assessments(assessment_id),
    achieved BOOLEAN DEFAULT false,
    achieved_age_months INTEGER,
    observed_by UUID REFERENCES users(user_id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 7. GROWTH RECORDS
-- ==========================================
-- Longitudinal anthropometric measurements separate from the
-- full assessment record, enabling frequent growth monitoring
-- (e.g., monthly weighing days).

CREATE TABLE growth_records (
    record_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    child_id VARCHAR(50) REFERENCES children(child_id) ON DELETE CASCADE,
    measurement_date DATE NOT NULL,
    height_cm DECIMAL(5,2),
    weight_kg DECIMAL(5,2),
    muac_cm DECIMAL(5,2),
    waz_score DECIMAL(4,2),   -- Weight-for-Age z-score
    haz_score DECIMAL(4,2),   -- Height-for-Age z-score
    whz_score DECIMAL(4,2),   -- Weight-for-Height z-score
    recorded_by UUID REFERENCES users(user_id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 8. OFFLINE SYNC MANAGEMENT
-- ==========================================
-- Tracks sync sessions between field devices and the central
-- server.  sync_mutations captures individual record-level
-- changes so conflicts can be detected and resolved.

CREATE TABLE sync_log (
    sync_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(user_id),
    device_id VARCHAR(100),
    sync_type VARCHAR(20) CHECK (sync_type IN ('push', 'pull', 'full')),
    records_sent INTEGER DEFAULT 0,
    records_received INTEGER DEFAULT 0,
    conflicts_detected INTEGER DEFAULT 0,
    sync_started_at TIMESTAMP WITH TIME ZONE,
    sync_completed_at TIMESTAMP WITH TIME ZONE,
    status VARCHAR(20) DEFAULT 'in_progress'
);

CREATE TABLE sync_mutations (
    mutation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sync_id UUID REFERENCES sync_log(sync_id),
    table_name VARCHAR(50) NOT NULL,
    record_id VARCHAR(100) NOT NULL,
    operation VARCHAR(10) CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
    payload JSONB NOT NULL,
    client_timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    conflict_resolution VARCHAR(20) DEFAULT 'pending',
    applied_at TIMESTAMP WITH TIME ZONE
);

-- ==========================================
-- 9. AUDIT & COMPLIANCE
-- ==========================================
-- Full audit trail for every significant user action, plus
-- explicit consent records for GDPR / POPI / local-law
-- compliance around child data.

CREATE TABLE audit_trail (
    audit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(user_id),
    action VARCHAR(50) NOT NULL,          -- e.g. LOGIN, VIEW, CREATE, UPDATE, DELETE, EXPORT
    resource_type VARCHAR(50) NOT NULL,   -- e.g. child, assessment, report
    resource_id VARCHAR(100),
    ip_address INET,
    user_agent TEXT,
    details JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE consent_records (
    consent_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    caregiver_id UUID REFERENCES caregivers(caregiver_id),
    child_id VARCHAR(50) REFERENCES children(child_id),
    consent_type VARCHAR(50) NOT NULL,     -- data_collection, photo, referral_share
    consent_given BOOLEAN NOT NULL,
    consent_method VARCHAR(50) NOT NULL,   -- verbal, written, thumbprint, digital
    witness_user_id UUID REFERENCES users(user_id),
    valid_from DATE NOT NULL,
    valid_until DATE,
    revoked_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 10. CONTENT LIBRARY
-- ==========================================
-- Stores intervention & educational content that can be
-- delivered to caregivers.  Supports offline caching via
-- offline_priority and self-referencing prerequisites.

CREATE TABLE content_library (
    content_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain VARCHAR(50) NOT NULL,
    age_band VARCHAR(20) NOT NULL,
    intensity VARCHAR(20) NOT NULL,       -- light, moderate, intensive
    format VARCHAR(20) NOT NULL,          -- video, audio, infographic, text
    language VARCHAR(20) NOT NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    file_url VARCHAR(500),
    file_size_kb INTEGER,
    duration_seconds INTEGER,
    offline_priority INTEGER DEFAULT 5,   -- 1 = cache first, 10 = cache last
    prerequisite_content_id UUID REFERENCES content_library(content_id),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 11. CAREGIVER INTERACTIONS
-- ==========================================
-- Tracks every touchpoint between the system (or an AWW) and
-- a caregiver, including content delivery and feedback.

CREATE TABLE caregiver_interactions (
    interaction_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    caregiver_id UUID REFERENCES caregivers(caregiver_id),
    child_id VARCHAR(50) REFERENCES children(child_id),
    interaction_type VARCHAR(50) NOT NULL,  -- sms, whatsapp, home_visit, group_session
    content_id UUID REFERENCES content_library(content_id),
    delivered_at TIMESTAMP WITH TIME ZONE,
    opened_at TIMESTAMP WITH TIME ZONE,
    activity_reported BOOLEAN DEFAULT false,
    feedback TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 12. INTERVENTION COMPLIANCE
-- ==========================================
-- Day-by-day tracking of whether planned activities in an
-- intervention plan were actually completed.

CREATE TABLE intervention_compliance (
    compliance_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id UUID REFERENCES intervention_plans(plan_id) ON DELETE CASCADE,
    activity_id UUID REFERENCES plan_activities(activity_id),
    compliance_date DATE NOT NULL,
    completed BOOLEAN DEFAULT false,
    reported_by VARCHAR(20),              -- caregiver, aww, supervisor
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 13. RISK DECISION LOG (AI AUDIT)
-- ==========================================
-- Every ML-model inference is logged here so that predictions
-- can be audited, explained (SHAP values), and reproduced.

CREATE TABLE risk_decision_log (
    log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    child_id VARCHAR(50) REFERENCES children(child_id),
    assessment_id UUID REFERENCES assessments(assessment_id),
    model_version VARCHAR(50) NOT NULL,
    input_features JSONB NOT NULL,
    output_score DECIMAL(5,2) NOT NULL,
    output_category VARCHAR(20) NOT NULL,  -- Low, Medium, High
    confidence DECIMAL(5,2),
    contributing_factors JSONB,
    shap_values JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 14. DAILY TASKS (AWW WORKFLOW AUTOMATION)
-- ==========================================
-- Auto-generated and manually created tasks that appear on
-- an AWW's daily work list (home visits, follow-ups, etc.).

CREATE TABLE daily_tasks (
    task_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(user_id) NOT NULL,
    task_date DATE NOT NULL,
    task_type VARCHAR(50) NOT NULL,        -- home_visit, follow_up, assessment_due, referral_check
    child_id VARCHAR(50) REFERENCES children(child_id),
    priority INTEGER DEFAULT 5,            -- 1 = highest
    description TEXT NOT NULL,
    action_required TEXT,
    status VARCHAR(20) DEFAULT 'pending',  -- pending, in_progress, completed, skipped
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 15. NOTIFICATION LOG
-- ==========================================
-- Central log for all outbound notifications (SMS, push,
-- WhatsApp, in-app) sent to users or caregivers.

CREATE TABLE notification_log (
    notification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(user_id),
    caregiver_id UUID REFERENCES caregivers(caregiver_id),
    channel VARCHAR(20) NOT NULL,          -- sms, push, whatsapp, in_app
    template_name VARCHAR(100),
    payload JSONB,
    status VARCHAR(20) DEFAULT 'pending',  -- pending, sent, delivered, failed
    sent_at TIMESTAMP WITH TIME ZONE,
    delivered_at TIMESTAMP WITH TIME ZONE,
    failed_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 16. INDEXES FOR PERFORMANCE
-- ==========================================

-- v1 indexes (existing)
CREATE INDEX idx_children_awc        ON children(awc_id);
CREATE INDEX idx_assessments_child   ON assessments(child_id);
CREATE INDEX idx_risk_category       ON risk_profiles(risk_category);
CREATE INDEX idx_alerts_active       ON intelligent_alerts(status) WHERE status = 'active';
CREATE INDEX idx_users_role          ON users(role);

-- v2 indexes (new)
CREATE INDEX idx_milestone_achievements_child   ON milestone_achievements(child_id);
CREATE INDEX idx_growth_records_child           ON growth_records(child_id, measurement_date);
CREATE INDEX idx_sync_log_user                  ON sync_log(user_id, sync_started_at);
CREATE INDEX idx_audit_trail_user               ON audit_trail(user_id, created_at);
CREATE INDEX idx_audit_trail_resource           ON audit_trail(resource_type, resource_id);
CREATE INDEX idx_consent_caregiver              ON consent_records(caregiver_id);
CREATE INDEX idx_content_domain                 ON content_library(domain, age_band, intensity);
CREATE INDEX idx_caregiver_interactions_child   ON caregiver_interactions(child_id);
CREATE INDEX idx_intervention_compliance_plan   ON intervention_compliance(plan_id);
CREATE INDEX idx_risk_decision_child            ON risk_decision_log(child_id, created_at);
CREATE INDEX idx_daily_tasks_user_date          ON daily_tasks(user_id, task_date);
CREATE INDEX idx_notification_log_status        ON notification_log(status) WHERE status = 'pending';

-- ==========================================
-- 17. SEED DATA — MILESTONE NORMS
-- ==========================================
-- 35 milestones across the five ECD domains, spanning ages
-- 0-72 months.  Assessment methods align with the DASII /
-- ASQ-3 approach used by the platform.

INSERT INTO milestone_norms (domain, milestone_name, expected_age_months_min, expected_age_months_max, assessment_method, age_band) VALUES
-- ── Gross Motor (GM) ─────────────────────────────────────
('Gross Motor', 'Holds head steady when held upright',               1,  3, 'Observation',      '0-6'),
('Gross Motor', 'Rolls from tummy to back',                          3,  5, 'Observation',      '0-6'),
('Gross Motor', 'Sits without support',                              5,  8, 'Observation',      '7-12'),
('Gross Motor', 'Pulls to standing position',                        8, 12, 'Observation',      '7-12'),
('Gross Motor', 'Walks independently',                              10, 15, 'Observation',      '13-18'),
('Gross Motor', 'Runs with coordination',                           18, 24, 'Observation',      '19-24'),
('Gross Motor', 'Jumps with both feet off ground',                  24, 36, 'Observation',      '25-36'),
('Gross Motor', 'Hops on one foot',                                 36, 48, 'Direct Test',      '37-48'),
('Gross Motor', 'Catches a bounced ball',                           48, 60, 'Direct Test',      '49-60'),

-- ── Fine Motor (FM) ──────────────────────────────────────
('Fine Motor', 'Grasps rattle placed in hand',                       1,  3, 'Observation',      '0-6'),
('Fine Motor', 'Transfers objects hand to hand',                     5,  8, 'Observation',      '7-12'),
('Fine Motor', 'Uses pincer grasp (thumb and forefinger)',           8, 12, 'Observation',      '7-12'),
('Fine Motor', 'Stacks two blocks',                                 12, 18, 'Direct Test',      '13-18'),
('Fine Motor', 'Scribbles spontaneously with crayon',               15, 20, 'Direct Test',      '13-18'),
('Fine Motor', 'Copies a vertical line',                            24, 30, 'Direct Test',      '25-36'),
('Fine Motor', 'Draws a circle',                                    36, 42, 'Direct Test',      '37-48'),
('Fine Motor', 'Cuts paper with scissors along a line',             48, 60, 'Direct Test',      '49-60'),

-- ── Language & Communication (LC) ────────────────────────
('Language & Communication', 'Coos and makes vowel sounds',          1,  4, 'Caregiver Report', '0-6'),
('Language & Communication', 'Babbles consonant-vowel combos',       6, 10, 'Caregiver Report', '7-12'),
('Language & Communication', 'Says first meaningful word',          10, 14, 'Caregiver Report', '7-12'),
('Language & Communication', 'Combines two words',                  18, 24, 'Caregiver Report', '19-24'),
('Language & Communication', 'Uses simple sentences (3+ words)',    24, 36, 'Caregiver Report', '25-36'),
('Language & Communication', 'Tells a simple story',                36, 48, 'Direct Test',      '37-48'),
('Language & Communication', 'Follows three-step instructions',     48, 60, 'Direct Test',      '49-60'),

-- ── Cognitive (COG) ──────────────────────────────────────
('Cognitive', 'Follows moving object with eyes',                     1,  3, 'Observation',      '0-6'),
('Cognitive', 'Looks for hidden object (object permanence)',          7, 12, 'Direct Test',      '7-12'),
('Cognitive', 'Matches shapes to holes in a shape sorter',          18, 24, 'Direct Test',      '19-24'),
('Cognitive', 'Sorts objects by color',                             24, 36, 'Direct Test',      '25-36'),
('Cognitive', 'Counts to 10 with 1:1 correspondence',              36, 48, 'Direct Test',      '37-48'),
('Cognitive', 'Understands concept of same / different',            48, 60, 'Direct Test',      '49-60'),

-- ── Social-Emotional (SE) ────────────────────────────────
('Social-Emotional', 'Social smile in response to face',             1,  3, 'Observation',      '0-6'),
('Social-Emotional', 'Shows stranger anxiety',                       6, 10, 'Caregiver Report', '7-12'),
('Social-Emotional', 'Engages in parallel play',                    18, 24, 'Observation',      '19-24'),
('Social-Emotional', 'Takes turns during play',                     30, 42, 'Observation',      '25-36'),
('Social-Emotional', 'Identifies own emotions (happy, sad, angry)', 36, 48, 'Caregiver Report', '37-48');

COMMIT;

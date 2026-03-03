-- ==========================================================
-- Early Childhood Development (ECD) Intelligence System
-- Production PostgreSQL Schema
-- ==========================================================
-- This schema handles user management (RBAC), child registries, 
-- multi-domain assessments, computed risk indexes, and generating actions.

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

-- Derived table storing calculated risk scores to prevent compute on every dashboard load
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
CREATE TYPE alert_status AS ENUM ('active', 'acknowledged', 'resolved');

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
-- 6. INDEXES FOR PERFORMANCE
-- ==========================================

CREATE INDEX idx_children_awc ON children(awc_id);
CREATE INDEX idx_assessments_child ON assessments(child_id);
CREATE INDEX idx_risk_category ON risk_profiles(risk_category);
CREATE INDEX idx_alerts_active ON intelligent_alerts(status) WHERE status = 'active';
CREATE INDEX idx_users_role ON users(role);

COMMIT;

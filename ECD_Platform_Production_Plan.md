# ECD Intelligence Platform — Production System Plan

## Context

India has 158M+ children under 6. The current ICDS framework is paper-based, non-standardized, and unable to detect developmental risk longitudinally. This plan transforms the existing React prototype (static JSON dashboard with Python data pipeline) into a production-grade, offline-first, government-deployable platform that works on 2G networks, basic Android devices, and with low-literacy AWWs.

**Existing codebase state**: React 18 + TypeScript + Vite frontend with 11 dashboard components, static JSON data service, Python risk scoring pipeline (817 lines), PostgreSQL schema (docs/schema.sql), 1000-child sample dataset across 4 districts in Andhra Pradesh. No backend API, no auth, no offline capability, no deployment infrastructure.

---

# DIMENSION 1 — FULL SYSTEM ARCHITECTURE

## 1.1 Problem Decomposition

| Technical Sub-Problem | Operational Sub-Problem | System Component |
|---|---|---|
| Data capture in offline/online environments | AWW field assessment workflow | Assessment Capture Module + Data Sync Engine |
| Risk inference from multi-domain developmental data | Supervisor review of flagged children | Risk Scoring Engine + Alert & Escalation Engine |
| Intervention recommendation and tracking | Caregiver activity delivery and compliance | Intervention Recommendation Engine + Caregiver Communication Module |
| Longitudinal developmental trajectory analysis | Government reporting chains (AWC→Mandal→District→State) | Longitudinal Tracking Module + Government Reporting Module |
| Role-based data access and visualization | Multi-role dashboard with appropriate scope | Role-Based Dashboard Module + Child Profile Management |
| Regulatory compliance and audit | Consent collection, data retention, breach response | Audit & Compliance Module |

## 1.2 Technology Stack

### Frontend: PWA (Progressive Web App)
- **Framework**: React 18 + TypeScript (existing) + Vite (existing)
- **Justification**: Existing codebase is React. PWA with service workers provides offline capability, installability on Android, and push notifications — all without rebuilding in native. Target devices (Android 6+ with Chrome) have full PWA support. Native would require 3-6 months of rebuild for marginal hardware access gains (camera via `getUserMedia` API suffices).
- **Offline storage**: Dexie.js (IndexedDB wrapper) — chosen over raw IndexedDB for its Promise-based API and live queries, over SQLite/WASM for smaller bundle size (~15KB vs ~800KB)
- **Trade-off**: PWA push notifications work on Android but not reliably on iOS. Acceptable because AWW population uses Android exclusively. If iOS is ever needed, a thin native wrapper (Capacitor) can be added.

### Backend: Node.js + Fastify with REST API
- **Justification**: Team is TypeScript-native. Fastify over Express for 2-3x throughput and built-in schema validation. REST over GraphQL because data patterns are bounded CRUD with filters — GraphQL adds complexity without proportional benefit. Each existing `dataService.ts` method maps to one REST endpoint.
- **API versioning**: `/api/v1/` prefix for all endpoints
- **Validation**: Zod (already a dependency in package.json)
- **Trade-off**: GraphQL would reduce over-fetching on 2G, but payloads are bounded (AWW sees ~40-50 children, ~15KB gzipped) and REST with field selection (`?fields=child_id,risk_category`) achieves similar efficiency.

### Database: PostgreSQL 15+
- **Justification**: Schema already designed in [docs/schema.sql](docs/schema.sql) with RBAC, child registry, assessments, risk profiles, alerts, interventions, referrals. PostgreSQL provides JSONB for flexible metadata, row-level security for RBAC, and partitioning for time-series assessment data.
- **Extensions required**: `pgcrypto` (column-level encryption for PII), `pg_trgm` (fuzzy name search for deduplication)

### AI/ML Layer: Python FastAPI Microservice
- **Justification**: Existing risk logic lives in [scripts/process_data.py](scripts/process_data.py). FastAPI provides async inference endpoints. Keeping ML in Python while web stays in TypeScript allows domain specialists to work independently.
- **Inference latency target**: <500ms per child (rule-based), <2s per child (ML model)
- **On-device vs cloud**: Rule-based scoring runs on-device for offline assessments (JavaScript port of the Python scoring logic). ML inference requires cloud. Hybrid: device produces preliminary score, cloud refines on sync.

### Caching: Redis 7+
- **Purpose**: JWT session cache (15-min TTL), rate limiting, pub/sub for real-time notifications, sync queue monitoring

### Messaging & Async: BullMQ (Redis-backed)
- **Purpose**: Async job queue for: risk scoring after assessment sync, alert generation, notification dispatch, report generation
- **Retry policy**: 3 retries with exponential backoff (1s, 5s, 25s)

### Infrastructure: NIC Cloud (primary)
- **Justification**: Government data sovereignty mandates NIC hosting. Architecture is containerized (Docker) for portability.
- **CDN**: NIC CDN or CloudFront for static assets (PWA shell, content library)
- **Disaster recovery**: Daily PostgreSQL WAL archiving to object storage, RPO < 1 hour, RTO < 4 hours
- **Trade-off**: NIC cloud has less automation than AWS/GCP. Mitigate with Docker Compose for single-server pilot, Kubernetes for scale phases. All manifests are cloud-agnostic.

## 1.3 Component-Level Breakdown

### Component 1: Child Profile Management Module
- **Responsibility**: CRUD operations for child registration, demographics, caregiver linkage
- **Inputs**: Registration form data from AWW, POSHAN Tracker imports
- **Outputs**: Child record in PostgreSQL, caregiver consent record
- **Internal logic**: Validate child_id uniqueness (format: `{STATE}_{ECD}_{NNNNNN}`), link to caregiver via `caregiver_id`, assign to AWC via `awc_id` from AWW's location scope
- **Failure mode**: Duplicate child_id → reject with conflict error, show existing record for merge review
- **Fallback**: If DB write fails, queue in Redis with TTL 24h, retry on next health check
- **Dependencies**: Auth Service (JWT), Location Service (AWC validation)

### Component 2: Assessment Capture Module
- **Responsibility**: Capture developmental assessments (all 5 DQ domains + nutrition + growth) online and offline
- **Inputs**: AWW form inputs — milestone observations, DQ scores, growth measurements, behavioral indicators
- **Outputs**: Assessment record in `assessments` table, triggers risk scoring pipeline
- **Internal logic**:
  - Online: POST `/api/v1/assessments` → Zod validation → DB insert → emit `assessment.created` event to BullMQ
  - Offline: Form data saved to IndexedDB `pendingSync` store with timestamp + operation type. When connectivity returns, Background Sync API posts mutations to `/api/v1/sync`
- **Validation rules**: `age_at_assessment_months` must match `(assessment_date - child.dob)`. DQ scores must be 0-200 range. At least 3 of 5 domain scores required for risk scoring.
- **Failure mode**: Network timeout during online submission → auto-switch to offline queue with optimistic UI confirmation + "pending sync" badge
- **Dependencies**: Data Sync Engine (offline path), Risk Scoring Engine (triggers on insert)

### Component 3: Risk Scoring Engine
- **Responsibility**: Compute composite risk score and category for each child
- **Inputs**: Assessment data (5 DQ scores, delay flags, neuro-behavioral indicators, nutrition score)
- **Outputs**: Risk profile record (`risk_profiles` table) with score, category, confidence, contributing domains
- **Internal logic**: Two-phase scoring:
  - Phase 1 (Rule-based, always available): Port of [process_data.py:250-314](scripts/process_data.py) logic:
    ```
    score = Σ(5 × each_delay_flag) + AUTISM_POINTS[risk] + ADHD_POINTS[risk] + BEHAVIOR_POINTS[risk] + (3 if nutrition_score ≥ 4)
    category = "Low" if score ≤ 10, "Medium" if score ≤ 25, "High" if score > 25
    confidence = min(98, 70 + (fields_filled/7) × 25 + (score/50) × 5)
    ```
  - Phase 2 (ML, after 6 months of data): XGBoost classifier called via FastAPI `/score` endpoint. Hybrid: `final = 0.7 × rule_based + 0.3 × ml_predicted` during validation, shifting to `0.3/0.7` after field validation.
- **Failure mode**: ML model unavailable → fall back to rule-based scoring (always available, including on-device)
- **Dependencies**: Assessment Capture Module (input), Alert & Escalation Engine (downstream)

### Component 4: Intervention Recommendation Engine
- **Responsibility**: Generate personalized intervention plans based on risk profile
- **Inputs**: Risk profile, child age, domain deficit profile, caregiver engagement history
- **Outputs**: Intervention plan with domain-specific activities, frequencies, caregiver formats
- **Internal logic**: Port of [process_data.py:424-534](scripts/process_data.py) — domain-specific activity mapping based on DQ thresholds:
  - DQ < 75 (delay): Intensive frequency (daily)
  - DQ 75-85 (concern): Moderate frequency (3x/week)
  - Activities matched from content library by domain + age band + intensity
  - Plans sorted by priority, capped at 5 activities to avoid caregiver overwhelm
- **Failure mode**: Content library unavailable → return generic plan templates cached locally
- **Dependencies**: Risk Scoring Engine (input), Content Library (activity catalog), Caregiver Communication Module (delivery)

### Component 5: Caregiver Communication Module
- **Responsibility**: Deliver intervention activities to caregivers via appropriate channels
- **Inputs**: Intervention plan, caregiver profile (language, phone type, literacy level)
- **Outputs**: Delivered messages via WhatsApp/SMS/IVR, delivery receipts, engagement tracking
- **Internal logic**: Fallback chain: WhatsApp Business API → SMS (MSG91) → IVR (Exotel) → AWW verbal delivery task
- **Failure mode**: All digital channels fail → create AWW task for next home visit with printed activity cards
- **Dependencies**: Third-party: Gupshup/Twilio (WhatsApp), MSG91/Kaleyra (SMS), Exotel (IVR). All require vendor contracts.

### Component 6: Alert & Escalation Engine
- **Responsibility**: Generate alerts from risk scores, route by severity, escalate unacknowledged alerts
- **Inputs**: Risk profile changes, assessment anomalies, stagnation/regression detection
- **Outputs**: Alert records in `intelligent_alerts` table, notifications dispatched to appropriate roles
- **Internal logic**: Port of [process_data.py:322-420](scripts/process_data.py):
  - P1 (Critical): composite_dq < 60, autism_risk == "High", num_delays ≥ 3, nutrition_score ≥ 5 → Route to AWW + Supervisor + CDPO
  - P2 (High): domain DQ < 70, cluster concentration > 15%, referral pending > 14 days → Route to AWW + Supervisor
  - P3 (Moderate): domain DQ 70-75, engagement_score < 30, missed follow-up → Route to AWW only
  - Escalation timeline: P1 unacknowledged at t+4h → Supervisor SMS; t+12h → CDPO WhatsApp; t+24h → State Admin dashboard
  - Deduplication: same child + same domain + same week → merge into existing alert
- **Failure mode**: Notification service down → alerts stored in DB, batch-sent on recovery
- **Dependencies**: Risk Scoring Engine (input), Notification Hub (dispatch)

### Component 7: Role-Based Dashboard Module
- **Responsibility**: Render appropriate views per authenticated role
- **Inputs**: User JWT (role, location_ids), filtered data from API
- **Outputs**: React dashboard views (existing components: [KPICards](src/components/dashboard/KPICards.tsx), [RiskDistribution](src/components/dashboard/RiskDistribution.tsx), [PredictiveInsights](src/components/dashboard/PredictiveInsights.tsx), etc.)
- **Internal logic**: Backend RBAC middleware filters data by role scope before API response. AWW sees own AWC only (~40 children). Supervisor sees sector (~200 children). CDPO sees district. State Admin sees aggregated only (no PII).
- **Failure mode**: API unavailable → serve cached dashboard from IndexedDB (stale data up to 7 days, with timestamp indicator)
- **Dependencies**: Auth Service, all data APIs

### Component 8: Longitudinal Tracking Module
- **Responsibility**: Track developmental trajectory across multiple assessment cycles
- **Inputs**: Time-series assessment data per child
- **Outputs**: Trend analysis (existing: [LongitudinalImpact](src/components/dashboard/LongitudinalImpact.tsx)), stagnation/regression alerts
- **Internal logic**:
  - Milestone velocity: `milestones_achieved_in_period / expected_milestones_in_period`
  - Stagnation: composite_dq_change < 2.0 over ≥ 3 months
  - Regression: composite_dq_change < -5.0 between any two consecutive assessments
  - Anomaly: |domain_dq_zscore| > 2.5 when previous was normal
- **Failure mode**: Insufficient data (< 2 assessments) → display "insufficient data" badge, no trend calculation
- **Dependencies**: Assessment Capture Module (longitudinal data), Risk Scoring Engine (re-scoring on new data)

### Component 9: Government Reporting Module
- **Responsibility**: Auto-generate reports in government-mandated formats
- **Inputs**: Aggregated analytics, KPIs, intervention coverage data
- **Outputs**: Monthly district PDF reports, quarterly state dashboards, ICDS MIS format files
- **Internal logic**: BullMQ scheduled job (1st of each month) aggregates data → generates PDF via Puppeteer → stores in object storage → sends to CDPO email
- **Failure mode**: Report generation timeout → retry with 1-hour delay, alert admin
- **Dependencies**: Analytics Aggregator, Object Storage

### Component 10: Data Sync Engine
- **Responsibility**: Bidirectional sync between device IndexedDB and server PostgreSQL
- **Inputs**: Offline mutation queue from device, server-side changes since last sync
- **Outputs**: Reconciled state on both client and server
- **Internal logic**:
  - **Sync protocol**: Last-Writer-Wins (LWW) by timestamp
  - **Why LWW over CRDTs**: Child assessments are append-only (new assessments, not edits to old ones). The only conflict scenario is two AWWs assessing the same child offline. LWW resolves with latest timestamp winning. Losing assessment preserved in `sync_mutations` table for supervisor review.
  - **Sync triggers**: (1) Connectivity detected (navigator.onLine event), (2) Scheduled (every 4 hours if online), (3) Manual (AWW taps "Sync Now")
  - **Data volume**: ~40 children × ~500 bytes each = ~20KB per full sync. Delta sync after initial: ~2KB per assessment.
  - **Conflict resolution UX**: Amber badge on records with conflicts, supervisor reviews and picks canonical version
- **Failure mode**: Sync interrupted mid-transfer → partial sync detected via transaction ID, resume from last confirmed record
- **Dependencies**: Dexie.js (client), PostgreSQL (server), BullMQ (async processing)

### Component 11: Audit & Compliance Module
- **Responsibility**: Log all data access, mutations, AI decisions for DPDP Act compliance
- **Inputs**: Every API request (via middleware), every risk score computation, every data export
- **Outputs**: Append-only audit records in `audit_trail` table
- **Internal logic**: Middleware intercepts all requests, logs `{user_id, role, action, resource_type, resource_id, ip, timestamp, details}`. AI decision audit includes: input features, model version, output score, confidence, contributing domains.
- **Failure mode**: Audit service down → buffer in-memory (max 1000 records), flush on recovery. Never block the main request flow for audit logging.
- **Dependencies**: Auth Service (user identity), PostgreSQL (storage)

## 1.4 Data Flow Diagram

### Online Path
```
AWW opens app
  → Service Worker checks cache freshness
  → If stale: GET /api/v1/children?scope=my_awc (JWT auth)
  → API Gateway (Nginx) → Fastify validates JWT → RBAC middleware filters by AWW's awc_id
  → PostgreSQL query → Response gzipped (~15KB for 40 children)
  → Stored in IndexedDB + rendered in React

AWW submits assessment
  → POST /api/v1/assessments (form data)
  → Fastify validates with Zod → INSERT into assessments table
  → BullMQ event: assessment.created
  → Risk Scoring Worker picks up → computes score → INSERT risk_profiles
  → Alert Generation Worker → evaluates P1/P2/P3 rules → INSERT intelligent_alerts
  → Notification Worker → dispatches FCM/WhatsApp/SMS based on severity
  → Intervention Worker → generates/updates intervention plan
  → Response to AWW: 201 Created + risk_category + alert_summary
```

### Offline Path
```
AWW opens app (no connectivity)
  → Service Worker serves cached app shell
  → Dexie.js provides data from IndexedDB
  → Dashboard renders with "OFFLINE" indicator + last sync timestamp

AWW submits assessment offline
  → Form data validated locally (Zod schemas shared with backend)
  → Saved to IndexedDB assessments store
  → Added to pendingSync store: {table: "assessments", op: "INSERT", data: {...}, timestamp: ISO}
  → On-device rule-based scoring runs (JavaScript port):
    score computed → preliminary risk category shown → "pending server confirmation" badge
  → Preliminary intervention shown from cached content library

Connectivity returns
  → Background Sync API triggers
  → POST /api/v1/sync with all pending mutations
  → Server applies each mutation with LWW conflict resolution
  → Server responds: {applied: N, conflicts: [...], server_changes: [...]}
  → Client applies server changes to IndexedDB
  → Client clears applied mutations from pendingSync
  → Dashboard re-renders with server-confirmed data
  → Preliminary risk scores replaced with server-computed scores
```

### Error/Conflict Resolution
```
Conflict scenario: AWW-A and AWW-B both assess child X offline

  → AWW-A syncs first: assessment A inserted (timestamp T1)
  → AWW-B syncs later: assessment B has timestamp T2
  → IF T2 > T1: assessment B wins (LWW), assessment A moved to sync_mutations as "superseded"
  → IF different data fields: both kept as separate assessment records (append-only)
  → Supervisor notified: "2 assessments for child X on same day — please review"
  → Supervisor dashboard shows both, supervisor selects canonical version
  → Non-canonical version archived with resolution_status = "manual_review_resolved"
```

## 1.5 Real-World Field Constraints

| Constraint | Impact | Mitigation |
|---|---|---|
| Android 6+, 2GB RAM | Must limit bundle size, memory usage | Target < 2MB PWA bundle. Tree-shake unused Radix UI components. Code-split by route. Lazy-load non-critical dashboard panels. |
| 16GB storage | IndexedDB + content cache must fit | Cap IndexedDB at 50MB (sufficient for 500 children + 1 year of assessments). Content library pre-cache limited to AWW's active children's interventions (~5MB audio/images). |
| 2G connectivity (50-100 Kbps) | API calls must be small, sync must be efficient | Gzip all responses. Delta sync (only changed records). Assessment payload: ~500 bytes. Full child list: ~15KB gzipped for 40 children. |
| Offline up to 7 days | All critical workflows must work offline | Assessment capture, child viewing, intervention viewing, daily task list — all from IndexedDB. Risk scoring via on-device JavaScript port. Mutation queue holds up to 500 operations. |
| AWW literacy: Class 10, local language | UI must be icon-first, voice-supported | Minimum 14px font (current codebase uses 10-11px — must fix). Icon-first navigation. Web Speech API for voice readout. Full i18n for Telugu, Hindi, English. |
| AWW workload: ~40 children, multiple programs | Must not add > 15 min/day overhead | Auto-prioritized daily task list. Assessment form pre-filled where possible. Tap-based milestone checklist (not free-text). |
| Intermittent rural power | Device may die mid-assessment | Auto-save form progress to IndexedDB every 30 seconds. Resume from last saved state on app reopen. |

## 1.6 Architecture Trade-offs

| Decision | Option A | Option B | Recommendation | Rationale |
|---|---|---|---|---|
| On-device ML vs server-side | On-device (TFLite) | Server-side (FastAPI) | **Hybrid**: Rule-based on-device, ML on server | Rule engine is 50 lines of JS, runs in <10ms offline. ML needs Python ecosystem + training data. On-device ML (TFLite) adds 5-20MB to app size and complexity for marginal benefit. |
| PWA vs Native Android | PWA (service workers) | React Native / Kotlin | **PWA** | Existing React codebase. PWA covers all requirements. Native only needed for advanced hardware (NFC, Bluetooth) which this system doesn't need. Saves 3-6 months of rebuild. |
| NIC Cloud vs Commercial | NIC GovCloud | AWS GovCloud India | **NIC primary, commercial fallback** | Government mandate for NIC. Docker containers are cloud-agnostic. If NIC has availability issues, can deploy to AWS Mumbai region with MeitY approval. |
| Centralized vs Federated DB | Single national PostgreSQL | State-level PostgreSQL instances | **Centralized with read replicas per state** | Centralized simplifies cross-state analytics. Read replicas reduce latency for state dashboards. Partitioning by state for data locality. Federated adds 10x operational complexity. |
| Real-time vs Batch scoring | Score on every assessment | Nightly batch re-score | **Real-time for individual, batch for recalibration** | AWW needs immediate feedback after assessment. Nightly batch recalculates Z-scores (which depend on population distribution) and catches drift. |

---

# DIMENSION 2 — DATA ENGINEERING + AI ENGINE

## 2.1 Data Schema Design

### Existing Schema (docs/schema.sql)
The current schema covers: `users`, `locations`, `user_locations`, `caregivers`, `children`, `assessments`, `risk_profiles`, `intelligent_alerts`, `intervention_plans`, `plan_activities`, `referrals`. All verified in [docs/schema.sql](docs/schema.sql).

### New Tables Required

```sql
-- Age-normed milestone mapping (reference data)
CREATE TABLE milestone_norms (
    milestone_id SERIAL PRIMARY KEY,
    domain VARCHAR(50) NOT NULL,         -- GM, FM, LC, COG, SE
    milestone_name VARCHAR(200) NOT NULL,
    expected_age_months_min INTEGER,      -- earliest normal achievement
    expected_age_months_max INTEGER,      -- latest normal achievement
    assessment_method VARCHAR(100),       -- "observation", "parent_report", "direct_test"
    age_band VARCHAR(20)                  -- '0-6m', '6-12m', '12-24m', '24-36m', '36-72m'
);

-- Child milestone achievements (longitudinal tracking)
CREATE TABLE milestone_achievements (
    achievement_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    child_id VARCHAR(50) REFERENCES children(child_id),
    milestone_id INTEGER REFERENCES milestone_norms(milestone_id),
    assessment_id UUID REFERENCES assessments(assessment_id),
    achieved BOOLEAN DEFAULT false,
    achieved_age_months INTEGER,
    observed_by UUID REFERENCES users(user_id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Growth measurements (frequent, separate from developmental assessment)
CREATE TABLE growth_records (
    record_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    child_id VARCHAR(50) REFERENCES children(child_id),
    measurement_date DATE NOT NULL,
    height_cm DECIMAL(5,2),
    weight_kg DECIMAL(5,2),
    muac_cm DECIMAL(5,2),
    waz_score DECIMAL(4,2),  -- Weight-for-age Z-score (WHO standard)
    haz_score DECIMAL(4,2),  -- Height-for-age Z-score
    whz_score DECIMAL(4,2),  -- Weight-for-height Z-score
    recorded_by UUID REFERENCES users(user_id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Offline sync management
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

-- DPDP Act compliance
CREATE TABLE audit_trail (
    audit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(user_id),
    action VARCHAR(50) NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
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
    consent_type VARCHAR(50) NOT NULL,   -- 'data_collection', 'ai_processing', 'data_sharing'
    consent_given BOOLEAN NOT NULL,
    consent_method VARCHAR(50) NOT NULL, -- 'verbal_witnessed', 'thumbprint', 'digital_signature'
    witness_user_id UUID REFERENCES users(user_id),
    valid_from DATE NOT NULL,
    valid_until DATE,
    revoked_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Content library for interventions
CREATE TABLE content_library (
    content_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain VARCHAR(50) NOT NULL,
    age_band VARCHAR(20) NOT NULL,
    intensity VARCHAR(20) NOT NULL,      -- 'intensive', 'moderate', 'preventive'
    format VARCHAR(20) NOT NULL,         -- 'audio', 'video', 'visual_card', 'text'
    language VARCHAR(20) NOT NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    file_url VARCHAR(500),
    file_size_kb INTEGER,
    duration_seconds INTEGER,
    offline_priority INTEGER DEFAULT 5,  -- 1=must cache, 10=optional
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Caregiver interaction log
CREATE TABLE caregiver_interactions (
    interaction_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    caregiver_id UUID REFERENCES caregivers(caregiver_id),
    child_id VARCHAR(50) REFERENCES children(child_id),
    interaction_type VARCHAR(50),         -- 'whatsapp', 'sms', 'ivr', 'aww_visit'
    content_id UUID REFERENCES content_library(content_id),
    delivered_at TIMESTAMP WITH TIME ZONE,
    opened_at TIMESTAMP WITH TIME ZONE,
    activity_reported BOOLEAN DEFAULT false,
    feedback TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Intervention compliance tracking
CREATE TABLE intervention_compliance (
    compliance_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id UUID REFERENCES intervention_plans(plan_id),
    activity_id UUID REFERENCES plan_activities(activity_id),
    compliance_date DATE NOT NULL,
    completed BOOLEAN DEFAULT false,
    reported_by VARCHAR(20),             -- 'caregiver', 'aww_observation'
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

### Partitioning Strategy (for scale)
```sql
-- Partition assessments by month for query performance at scale
CREATE TABLE assessments (
    -- same columns as existing schema
) PARTITION BY RANGE (assessment_date);

CREATE TABLE assessments_2026_q1 PARTITION OF assessments
    FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
-- Auto-create quarterly partitions via pg_partman extension
```

## 2.2 Data Ingestion Pipeline

### Manual Input (AWW Field Forms)
```
AWW taps "New Assessment" → form pre-filled with child demographics
  → AWW enters milestone observations (checkbox-based, not free text)
  → AWW enters growth measurements (height, weight, MUAC)
  → Client-side validation:
    - age_months = floor((assessment_date - dob) / 30.44)
    - DQ scores: 0-200 range check
    - Growth: height 30-130cm, weight 1-30kg, MUAC 5-25cm
    - At least 3 of 5 domain scores required
  → Save to IndexedDB (offline-safe)
  → If online: POST /api/v1/assessments → server validation → DB insert → risk scoring triggered
```

### Conflict Resolution (Offline Sync)
```
POST /api/v1/sync
Body: { mutations: [...], last_sync_timestamp: "2026-03-20T10:00:00Z" }

Server processing:
FOR each mutation:
    IF mutation.operation == "INSERT" AND record_id NOT EXISTS:
        INSERT directly (no conflict possible for new records)
    ELIF mutation.operation == "INSERT" AND record_id EXISTS:
        Compare timestamps. If client_timestamp > server_record.updated_at:
            UPDATE with client data (LWW)
        ELSE:
            Flag as conflict, preserve both versions
    ELIF mutation.operation == "UPDATE":
        Compare field-level timestamps where available
        Apply LWW per-field for assessment data
        Log conflict in sync_mutations table

Return: {
    applied: number,
    conflicts: [{record_id, server_version, client_version}],
    server_changes_since: [{table, records}]  // for client to apply
}
```

### External System Integration
- **POSHAN Tracker**: REST API pull for nutrition data (height, weight, MUAC). Fallback: monthly CSV import via admin upload interface. Map by Aadhaar (where available) or child_id + AWC code.
- **NHM/HMIS**: HL7 FHIR R4 messaging for referral status updates. Fallback: manual status update by health worker.
- **Civil Registration**: Birth record import for new child enrollment. Batch ETL via government API (where available) or manual entry.

## 2.3 Data Cleaning & Normalization

### Age Adjustment for Prematurity
```python
corrected_age_months = chronological_age_months - (40 - gestational_weeks) * (30.44 / 7)
# Apply correction until 24 months chronological age, then use actual age
if chronological_age_months > 24:
    corrected_age_months = chronological_age_months
```

### Handling Missing Data
- Missing DQ score: Skip that domain in composite calculation, adjust denominator
- `composite_dq = sum(available_dq_scores) / count(available_dq_scores)`
- Minimum 3 of 5 domains required to produce composite score
- If < 3 domains: risk score produced with `confidence = max(50, confidence - 20)` and "incomplete assessment" flag

### Outlier Detection
```python
for domain in ['gm_dq', 'fm_dq', 'lc_dq', 'cog_dq', 'se_dq']:
    if abs(z_score) > 3.5:
        flag_for_review("Extreme outlier", domain, child_id)
        # Don't auto-reject — could be genuinely extreme case
        # Add to supervisor review queue
```

### Deduplication
```python
# Fuzzy match for duplicate children (different AWWs registering same child)
from pg_trgm:
SELECT a.child_id, b.child_id, similarity(a.first_name, b.first_name) as name_sim
FROM children a, children b
WHERE a.child_id != b.child_id
  AND a.dob = b.dob
  AND a.gender = b.gender
  AND similarity(a.first_name, b.first_name) > 0.6
  AND ST_Distance(a.awc_location, b.awc_location) < 10000  -- within 10km
```

## 2.4 Feature Engineering

### Existing Features (from process_data.py)
Already implemented in [scripts/process_data.py:229-314](scripts/process_data.py):
- Z-scores for 5 DQ domains + composite (population-level standardization)
- Delay flags per domain (binary: 0 or 1)
- Neuro-behavioral risk classifications (Low/Moderate/High)
- Nutrition composite score (underweight + stunting + wasting + anemia)
- Contributing domain attribution with point breakdown

### New Features to Add

**Age-Adjusted Developmental Quotient:**
```
DQ_domain = (developmental_age_months / chronological_age_months) × 100
# Already computed in Excel data. Pipeline must validate: if age_months == 0, set DQ = null
```

**Milestone Velocity (requires ≥ 2 assessment cycles):**
```
milestone_velocity = milestones_achieved_in_period / expected_milestones_in_period
# velocity < 0.7 → "decelerating" flag
# velocity < 0.5 → "stagnating" flag
# velocity > 1.2 → "accelerating" (positive signal)
```

**Domain Deficit Severity Score:**
```
severity_score(domain) = max(0, (expected_dq - observed_dq) / expected_dq × 100)
# expected_dq = 100 (age-normed)
# severity_score = 0 means on track, 25 means 25% below expected
```

**Composite Risk Score v2 (enhanced with environmental factors):**
```
developmental_risk = existing formula (max 58 points)
environmental_risk = (
    (5 - parent_child_interaction_score) × 2 +  -- max 10
    (5 - home_stimulation_score) × 2 +           -- max 10
    (play_materials == "No" ? 3 : 0) +           -- max 3
    (safe_water == "No" ? 2 : 0) +               -- max 2
    (toilet_facility == "No" ? 2 : 0)            -- max 2
)   -- max 27

composite_risk_v2 = 0.65 × developmental_risk + 0.20 × nutrition_risk + 0.15 × environmental_risk
```
**Note**: V2 formula requires government stakeholder approval before deployment. Start with existing formula.

**Caregiver Engagement Score (protective factor):**
```
engagement_score = (
    0.30 × (followup_conducted == "Yes" ? 1 : 0) +
    0.25 × (home_activities_assigned / max_expected_activities) +
    0.20 × (play_materials == "Yes" ? 1 : 0) +
    0.15 × (parent_child_interaction_score / 5) +
    0.10 × (home_stimulation_score / 5)
) × 100
```

## 2.5 Risk Scoring Model

### A) Formula-Based Rule Engine (existing, production-ready)

Exact logic from [process_data.py:250-314](scripts/process_data.py):

```
INPUTS:
  gm_delay, fm_delay, lc_delay, cog_delay, se_delay    (binary: 0 or 1)
  autism_risk, adhd_risk, behavior_risk                  (Low/Moderate/High)
  nutrition_score                                         (0-8 integer)

SCORING:
  score = 0
  score += 5 × gm_delay                                 -- max 5
  score += 5 × fm_delay                                 -- max 5
  score += 5 × lc_delay                                 -- max 5
  score += 5 × cog_delay                                -- max 5
  score += 5 × se_delay                                 -- max 5
  score += {High: 15, Moderate: 8, Low: 0}[autism_risk] -- max 15
  score += {High: 8, Moderate: 4, Low: 0}[adhd_risk]    -- max 8
  score += {High: 7, Moderate: 3, Low: 0}[behavior_risk]-- max 7
  score += 3 if nutrition_score >= 4                     -- max 3
                                               TOTAL MAX: 58

THRESHOLDS:
  Low:    score ≤ 10
  Medium: score 11-25
  High:   score > 25

OVERRIDE RULES:
  IF autism_risk == "High": minimum category = "Medium"
  IF num_delays >= 3: minimum category = "Medium"
  IF composite_dq < 60: force category = "High"

CONFIDENCE:
  fields_filled = count(non-zero values in [gm_dq, fm_dq, lc_dq, cog_dq, se_dq, behaviour_score, nutrition_score])
  completeness = fields_filled / 7
  confidence = min(98, round(70 + completeness × 25 + (score / 50) × 5, 1))
```

**Advantages**: Fully transparent, auditable by government officials, no training data needed, deterministic.
**Limitations**: Static thresholds, cannot capture non-linear domain interactions, cannot learn from outcomes.

### B) ML-Based Model (Phase 2, after 6+ months of pilot data)

**Algorithm**: XGBoost Gradient Boosted Trees (3-class classifier: Low/Medium/High)
- **Why XGBoost**: Best performer on tabular data with small-to-medium datasets. Handles missing values natively. Feature importance built-in. Faster inference than neural networks (~1ms per prediction).
- **Why not deep learning**: Dataset too small (<10K records initially). Tabular data doesn't benefit from deep learning. Interpretability requirements favor tree models.
- **Why not logistic regression**: Cannot capture non-linear interactions between domains (e.g., co-occurring motor + language delay is worse than the sum of individual delays).

**Training data requirements**:
- Minimum: 2,000 children with at least 2 assessment cycles and outcome labels
- Labels: Expert clinical assessment (ground truth) + 6-month outcome (improved/same/worsened)
- Feature set: 15 features (5 DQ z-scores, 5 delay flags, 3 neuro-behavioral risk encoded, nutrition_score, composite_dq)

**Feature importance**: SHAP (SHapley Additive exPlanations) values for each prediction, surfaced in supervisor dashboard.

### C) Hybrid Approach (Recommended)

```
Phase 1 (Months 1-6): Rule engine only
  → All risk scores via formula
  → Collect outcome data for ML training

Phase 2 (Months 7-12): Shadow mode
  → ML model trained, runs in parallel
  → Scores compared but not shown to users
  → Validate: ML sensitivity ≥ rule engine sensitivity

Phase 3 (Months 13+): Hybrid scoring
  → hybrid_score = α × rule_score + (1-α) × ml_score
  → α starts at 0.7, decreases to 0.3 as ML validation improves
  → Rule engine as guardrails: if rule_engine says High but ML says Low, flag for review
  → ML used for nuanced stratification within Medium band
```

## 2.6 Explainability Mechanism

**Per-domain breakdown** (already implemented in `contributing_domains` field):
```json
{
  "contributing_domains": [
    {"domain": "Language/Communication", "points": 5, "reason": "Developmental delay detected"},
    {"domain": "Autism Risk", "points": 15, "reason": "Autism risk: High"},
    {"domain": "ADHD Risk", "points": 8, "reason": "ADHD risk: High"}
  ]
}
```

**Plain-language explanation for AWW** (new, generated from contributing_domains):
```
"This child needs attention because:
 1. Speech development is behind schedule
 2. Shows signs that need autism specialist review
 3. Shows attention difficulty signs"
```
Generated via template mapping, not LLM — deterministic, auditable, translatable.

**Decision audit log** (new table):
```sql
CREATE TABLE risk_decision_log (
    log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    child_id VARCHAR(50) REFERENCES children(child_id),
    assessment_id UUID REFERENCES assessments(assessment_id),
    model_version VARCHAR(50),           -- 'rule_v1', 'xgb_v2.1', 'hybrid_v3'
    input_features JSONB,                -- complete feature vector
    output_score DECIMAL(5,2),
    output_category VARCHAR(20),
    confidence DECIMAL(5,2),
    contributing_factors JSONB,           -- domain breakdown
    shap_values JSONB,                   -- null for rule-based, populated for ML
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

## 2.7 Early Warning Detection Logic

```python
# Stagnation Detection (requires ≥ 2 assessments, ≥ 3 months apart)
def detect_stagnation(child_assessments):
    if len(child_assessments) < 2:
        return None
    latest = child_assessments[-1]
    previous = child_assessments[-2]
    months_elapsed = (latest.assessment_date - previous.assessment_date).days / 30.44

    if months_elapsed < 3:
        return None

    dq_change = latest.composite_dq - previous.composite_dq
    if dq_change < 2.0:  # Less than 2-point improvement over 3+ months
        return Alert(
            domain="Multi-domain",
            indicator="Developmental Stagnation",
            severity="moderate" if dq_change >= 0 else "high",
            message=f"Composite DQ change: {dq_change:.1f} over {months_elapsed:.0f} months",
            suggested_action="Intensify current interventions; consider specialist referral"
        )

# Regression Detection (any consecutive assessment pair)
def detect_regression(child_assessments):
    if len(child_assessments) < 2:
        return None
    latest = child_assessments[-1]
    previous = child_assessments[-2]

    dq_change = latest.composite_dq - previous.composite_dq
    if dq_change < -5.0:  # > 5-point decline
        return Alert(
            domain="Multi-domain",
            indicator="Developmental Regression",
            severity="critical",
            message=f"Composite DQ declined by {abs(dq_change):.1f} points",
            suggested_action="Urgent: investigate cause, specialist referral, daily monitoring"
        )

    # Per-domain regression
    alerts = []
    for domain in ['gm_dq', 'fm_dq', 'lc_dq', 'cog_dq', 'se_dq']:
        domain_change = getattr(latest, domain) - getattr(previous, domain)
        if domain_change < -10.0:  # > 10-point decline in single domain
            alerts.append(Alert(
                domain=domain_labels[domain],
                indicator=f"{domain_labels[domain]} Regression",
                severity="high",
                message=f"{domain_labels[domain]} DQ declined by {abs(domain_change):.1f}"
            ))
    return alerts

# Anomaly Detection (statistical)
def detect_anomaly(child_assessment, population_stats):
    for domain in ['gm_dq', 'fm_dq', 'lc_dq', 'cog_dq', 'se_dq']:
        z = (getattr(child_assessment, domain) - population_stats[domain]['mean']) / population_stats[domain]['std']
        if abs(z) > 2.5:
            return Alert(
                domain=domain_labels[domain],
                indicator="Statistical Anomaly",
                severity="high" if z < -2.5 else "moderate",
                message=f"{domain_labels[domain]} Z-score: {z:.2f} (extreme outlier)",
                suggested_action="Verify assessment accuracy; if confirmed, specialist evaluation"
            )
```

## 2.8 Model Validation Strategy

**Ground truth labeling**:
- Primary: Expert clinical assessment by District Early Intervention Centre (DEIC) staff on sample of 500+ children
- Secondary: 6-month outcome trajectory (improved/same/worsened) as proxy label
- Label agreement check: clinical assessment vs outcome trajectory concordance ≥ 80%

**Performance targets**:
| Metric | Target | Rationale |
|---|---|---|
| Sensitivity (High risk) | ≥ 90% | Cannot miss truly high-risk children |
| Specificity (High risk) | ≥ 85% | Some false positives acceptable to avoid misses |
| Sensitivity (Medium risk) | ≥ 85% | Important but less critical than High |
| F1 (weighted) | ≥ 0.85 | Overall balanced performance |

**Field validation protocol**:
1. Select 500 children stratified by risk category (200 High, 200 Medium, 100 Low)
2. DEIC clinician assesses each child independently (blinded to model score)
3. Compare model classification vs clinical classification
4. Compute confusion matrix, sensitivity/specificity per class
5. If sensitivity < 90% for High risk: adjust thresholds, retrain, re-validate

**Continuous monitoring post-deployment**:
- Weekly: Compare risk score distribution to historical baseline. Alert if any category shifts > 5%.
- Monthly: Sample 50 randomly selected risk scores, have supervisor verify reasonableness.
- Quarterly: Full field validation on 200-child sample.

## 2.9 Handling Missing & Incomplete Data

| Scenario | Minimum Data | Action |
|---|---|---|
| All 5 DQ domains + nutrition + behavior | Full confidence score | Normal scoring |
| 3-4 of 5 DQ domains present | Adjust composite to available domains | Score with confidence penalty: `confidence = confidence - (2 - missing_count) × 10` |
| < 3 DQ domains present | Cannot produce reliable composite | Withhold composite risk score. Show per-domain scores that exist. Flag "Incomplete Assessment — please complete." |
| Nutrition data missing | Can score developmental risk | Produce developmental-only risk. Nutrition risk = "Unknown". Flag for follow-up. |
| No assessment data (registration only) | Demographics only | No risk score. Child appears in "Awaiting First Assessment" list. |

**Imputation strategy**: Do NOT impute missing DQ scores with population means. Missing data indicates an incomplete assessment, not a normal value. Instead, score with available data and reduced confidence.

## 2.10 Bias & Fairness

**Potential bias vectors**:
1. **Geography**: Urban AWCs may report more completely, inflating risk detection vs rural
2. **Gender**: Cultural bias may lead to under-reporting of girls' developmental concerns
3. **Caste/Tribal**: Systemic under-enrollment of marginalized communities
4. **Maternal literacy**: Higher-literacy caregivers may report more milestones, lowering apparent risk
5. **District data quality**: Variation in AWW training quality affects assessment accuracy

**Fairness metrics**:
```
For each subgroup S in {gender, district, age_band, caste_category}:
    sensitivity_S = TP_S / (TP_S + FN_S)

    IF |sensitivity_S - sensitivity_overall| > 0.05:
        FLAG "Bias alert: {subgroup} sensitivity deviates by {delta}"
```
Equalized false negative rates are critical — we cannot accept a model that misses high-risk children in one subgroup at a higher rate than others.

**Monitoring plan**: Monthly bias audit report generated automatically. Quarterly review by ethics committee (to be constituted with government, domain experts, community representatives).

## 2.11 Model Update Strategy

- **Approach**: Versioned periodic retraining (not continuous learning)
- **Cadence**: Quarterly retraining with accumulated data
- **Data flywheel**: Assessment outcomes (improved/same/worsened at 6 months) feed back as training labels
- **Governance**:
  1. Data science team trains new model version
  2. Validation on held-out test set + bias audit
  3. Shadow deployment (runs in parallel, scores logged but not shown)
  4. Clinical expert review of 100 discrepant scores (new model vs old)
  5. State admin approval required before production deployment
  6. Rollback plan: previous model version remains deployable within 1 hour

---

# DIMENSION 3 — INTERVENTION + CAREGIVER SYSTEM

## 3.1 Intervention Mapping Logic

Direct mapping from existing [process_data.py:424-534](scripts/process_data.py), formalized:

| Domain | DQ Range | Intensity | Activity Category | Frequency | Duration |
|---|---|---|---|---|---|
| Speech & Language | < 60 | Intensive | Speech therapy referral + daily structured stimulation | Daily | 15 min |
| Speech & Language | 60-75 | Moderate | Picture card narration, story time, naming games | 3x/week | 10 min |
| Speech & Language | 75-85 | Preventive | Reading together, singing rhymes, conversation prompts | 2x/week | 10 min |
| Gross Motor | < 60 | Intensive | Physiotherapy referral + structured exercises | Daily | 20 min |
| Gross Motor | 60-75 | Moderate | Crawling, climbing, balancing exercises | 3x/week | 15 min |
| Gross Motor | 75-85 | Preventive | Active play, running, jumping activities | 2x/week | 15 min |
| Fine Motor | < 60 | Intensive | Occupational therapy referral + daily manipulation tasks | Daily | 15 min |
| Fine Motor | 60-75 | Moderate | Bead threading, clay molding, crayon activities | 4x/week | 15 min |
| Fine Motor | 75-85 | Preventive | Drawing, tearing paper, buttoning practice | 2x/week | 10 min |
| Cognitive | < 60 | Intensive | Specialist referral + daily learning games | Daily | 15 min |
| Cognitive | 60-75 | Moderate | Pattern recognition, shape sorting, puzzles | 3x/week | 10 min |
| Cognitive | 75-85 | Preventive | Object permanence games, simple problem-solving | 2x/week | 10 min |
| Socio-Emotional | < 60 | Intensive | Child psychologist referral + daily interaction activities | Daily | 15 min |
| Socio-Emotional | 60-75 | Moderate | Group play, emotion-naming, turn-taking | 3x/week | 15 min |
| Socio-Emotional | 75-85 | Preventive | Attachment-building activities, shared play | 2x/week | 10 min |
| Nutrition | score ≥ 5 | Intensive | NRC referral + supplementary nutrition | Daily monitoring | ongoing |
| Nutrition | score 3-4 | Moderate | Growth monitoring + dietary counseling | Weekly | ongoing |
| Behavioral | High risk | Intensive | Positive reinforcement, caregiver guidance | Daily | 10 min |
| Behavioral | Moderate risk | Moderate | Behavioral regulation activities | 3x/week | 10 min |

## 3.2 Intervention Content Library

**Minimum viable library for pilot**: 120 activity items
- 5 domains × 3 intensity levels × 5 age bands = 75 domain-specific items
- 15 nutrition counseling items (5 age bands × 3 types)
- 15 behavioral intervention items
- 15 caregiver wellness/engagement items

**Content formats per literacy level**:
| Format | File Type | Max Size | Target Audience | Details |
|---|---|---|---|---|
| Audio | MP3/OGG, 64kbps | 500KB (60-90s) | Illiterate caregivers | Vernacular narration, step-by-step activity instructions |
| Visual Card | WebP image | 100KB | Semi-literate caregivers | Illustrated card sequences showing activity steps, no text required |
| Text | JSON-rendered in app | 2KB | Literate caregivers/AWWs | Simplified text, Class 5 reading level, local script |
| Video | MP4, 480p, H.264 | 5MB (2-3 min) | Training/reference | Demonstration videos, cached on first download |

**Tagging schema** (for content_library table):
- `domain`: GM, FM, LC, COG, SE, NUT, BEH
- `age_band`: '0-6m', '6-12m', '12-24m', '24-36m', '36-72m'
- `intensity`: 'intensive', 'moderate', 'preventive'
- `format`: 'audio', 'video', 'visual_card', 'text'
- `language`: 'Telugu', 'Hindi', 'English', 'Urdu', 'Tamil'
- `prerequisite_content_id`: UUID (for sequenced activities)

**Localization strategy**:
- Phase 1 (Pilot): Telugu + English (AP deployment)
- Phase 2 (State): + Hindi + Urdu
- Phase 3 (National): + Tamil, Kannada, Malayalam, Bengali, Marathi, Gujarati, Odia
- All audio re-recorded by native speakers (not TTS)

## 3.3 Personalization Engine

```python
def generate_intervention_plan(child, risk_profile, engagement_history):
    """Generate personalized weekly intervention plan."""

    # Determine age band
    age_band = get_age_band(child.age_months)
    # '0-6m', '6-12m', '12-24m', '24-36m', '36-72m'

    activities = []

    # Step 1: Identify deficit domains from risk profile
    for domain in risk_profile.contributing_domains:
        dq_value = getattr(child, f"{domain.code}_dq")

        if dq_value < 60:
            intensity = "intensive"
        elif dq_value < 75:
            intensity = "moderate"
        elif dq_value < 85:
            intensity = "preventive"
        else:
            continue  # No intervention needed

        # Step 2: Match content from library
        content = content_library.query(
            domain=domain.code,
            age_band=age_band,
            intensity=intensity,
            language=child.caregiver.primary_language,
            format=get_preferred_format(child.caregiver)
        )

        # Step 3: Check engagement history — if caregiver completed previous activity, advance
        if engagement_history.last_activity_completed(domain.code):
            content = content.next_in_sequence()

        activities.append({
            "domain": domain.name,
            "content_id": content.content_id,
            "activity": content.title,
            "frequency": FREQUENCY_MAP[intensity],
            "duration_minutes": DURATION_MAP[domain.code][intensity],
            "caregiver_format": content.format,
            "priority": 1 if intensity == "intensive" else 2 if intensity == "moderate" else 3
        })

    # Step 4: Cap at 5 activities to avoid overwhelm
    activities.sort(key=lambda x: x["priority"])
    return activities[:5]

def get_preferred_format(caregiver):
    """Determine best content format based on caregiver profile."""
    if caregiver.education_level in ("Illiterate", "Primary"):
        return "audio"
    elif caregiver.education_level in ("Middle", "Secondary"):
        return "visual_card"
    else:
        return "text"
```

## 3.4 Dynamic Adjustment Mechanism

```
On new assessment submission for child with active intervention plan:
    1. Re-score risk → get new risk_category
    2. Compare to previous risk_category

    IF risk_category improved (e.g., High → Medium):
        → De-escalate: reduce frequency (Daily → 3x/week)
        → Add next-level activities for improving domains
        → Send positive reinforcement to caregiver
        → Notify AWW: "Child X showing improvement in {domain}"

    IF risk_category unchanged after ≥ 3 months:
        → Escalate: increase frequency or intensity
        → Flag for supervisor review
        → Consider specialist referral if not already done
        → Notify supervisor: "Child X not responding to intervention — review needed"

    IF risk_category worsened:
        → Immediate escalation to P1 alert
        → Generate specialist referral
        → Intensify all active interventions
        → Notify AWW + Supervisor + CDPO

Adjustment frequency: On every new assessment (minimum quarterly, per ICDS schedule)
```

## 3.5 Caregiver Delivery System

### Delivery Fallback Chain
```
attempt_delivery(caregiver, intervention_content):

    Step 1: WhatsApp Business API (Gupshup/Twilio)
        → Send template message: activity name + audio clip/image
        → Cadence: Weekly (Monday 9am), with mid-week reminder (Thursday 6pm)
        → Cost: ~INR 4/message
        → Check: delivery_receipt within 24 hours
        → IF delivered: DONE

    Step 2: SMS Gateway (MSG91/Kaleyra)
        → Send: 160-char summary of activity + shortened link to audio
        → DLT-registered template (mandatory in India)
        → Cost: ~INR 0.20/SMS
        → IF delivered: DONE

    Step 3: IVR Call (Exotel/Ozonetel)
        → Call caregiver's number
        → Play: 60-second audio instruction in regional language
        → Interactive: "Press 1 if you will try this activity this week"
        → Cost: ~INR 1.50/minute
        → IF call answered AND duration > 10s: DONE

    Step 4: AWW Verbal Delivery
        → Create task in AWW's daily checklist: "Explain {activity} to {caregiver} at next home visit"
        → AWW records delivery confirmation after home visit
        → Provide AWW with printed visual card to leave with caregiver
```

### Offline Delivery for Illiterate Caregivers
- AWW carries pre-printed visual activity cards (laminated, reusable)
- Cards organized by domain and age band in a flip-book format
- AWW demonstrates activity during home visit
- AWW records: "Activity demonstrated: Yes/No", "Caregiver understood: Yes/No"
- No digital literacy required from caregiver

## 3.6 Engagement & Compliance Tracking

**Compliance metrics**:
```
message_engagement = messages_opened / messages_sent
activity_compliance = activities_reported_complete / activities_assigned
followup_compliance = followups_conducted / followups_scheduled
```

**Engagement score formula**:
```
engagement_score = (
    0.30 × (followup_conducted == "Yes" ? 1 : 0) +
    0.25 × min(1.0, home_activities_completed / home_activities_assigned) +
    0.20 × (play_materials == "Yes" ? 1 : 0) +
    0.15 × (parent_child_interaction_score / 5) +
    0.10 × (home_stimulation_score / 5)
) × 100
```

**Low-engagement detection and nudge strategy**:
| Engagement Score | Classification | Nudge Sequence |
|---|---|---|
| < 20 | Critical | Day 1: AWW home visit. Day 3: Supervisor call. Day 7: CDPO notification. |
| 20-40 | Low | Day 1: WhatsApp reminder. Day 3: SMS. Day 7: AWW verbal during next visit. |
| 40-60 | Moderate | Weekly WhatsApp encouragement. Bi-weekly AWW check-in. |
| 60-80 | Good | Bi-weekly WhatsApp reinforcement. Monthly progress celebration message. |
| > 80 | Excellent | Monthly recognition message. Peer motivation (anonymized group success stories). |

**Behavioral design principles for nudges**:
- Timing: Messages sent at 9am (after morning routine, before daily work)
- Tone: Encouraging, not prescriptive ("You're doing great for {child_name}! This week, try...")
- Messenger effect: Critical nudges come from AWW (trusted relationship), routine from system
- Social proof: "42 families in your village are doing activities this week"

## 3.7 Field Usability Constraints for AWW

**AWW workload budget**: Maximum 15 additional minutes per child per month (assessments are quarterly, so ~5 min/child for routine monitoring + intervention tracking)

**Task allocation**:
| Task | Performed by | Time per child |
|---|---|---|
| Quarterly developmental assessment | AWW (with app guidance) | 10-15 min |
| Monthly growth measurement | AWW | 3-5 min |
| Intervention activity demonstration | AWW during home visit | 5-10 min |
| Daily task list review | AWW | 5 min total (not per child) |
| Sync data | Automated / AWW taps button | 30 sec |
| Record compliance observation | AWW | 1 min per child |

**What AWW does NOT do** (automated):
- Risk score computation
- Intervention plan generation
- Alert generation and routing
- Report generation
- Caregiver message delivery (WhatsApp/SMS/IVR)

## 3.8 Feedback Loop into AI System

```
Intervention compliance data (caregiver_interactions table)
    ↓
Feature: avg_compliance_rate_30d (rolling 30-day compliance %)
    ↓
Added to ML feature vector for risk scoring v2
    ↓
If high compliance + no improvement → signals possible mis-targeted intervention
    ↓
Triggers intervention plan review by supervisor

Caregiver response data (which activities were reported as "easy" vs "difficult")
    ↓
Content ranking adjustment: easier activities promoted for similar profiles
    ↓
Quarterly content library effectiveness review:
    activities with < 30% compliance rate → flagged for redesign
    activities with > 70% compliance + positive outcomes → promoted
```

---

# DIMENSION 4 — ROLE-BASED DASHBOARD + UX SYSTEM

## 4.1 Role Architecture

| Role | Read Access Scope | Write Access Scope | Alert Types Visible | Default View |
|---|---|---|---|---|
| AWW | Own AWC's children (PII visible) | Create assessments, log compliance, update referral status | P3 (own), P2 (own), P1 (own) | Daily task list |
| Mukhya Sevika (Supervisor) | All AWCs in sector (~5-8 AWCs, ~200-400 children, PII visible) | Override risk scores, approve referrals, resolve alerts | P2 (sector), P1 (sector) | AWC comparison + flagged cases |
| CDPO | All sectors in project/block (aggregated, PII masked) | Approve district reports, manage AWWs, escalate to state | P1 (district), cluster alerts | Risk heatmap + trend charts |
| State Admin | All districts (aggregated only, no PII) | Manage CDPOs, approve model updates, system configuration | P1 (state), anomaly alerts | State overview + district comparison |
| National Admin | All states (aggregated only, no PII) | National policy configuration, cross-state analytics | National-level anomalies | National dashboard |
| Health Worker (ASHA/ANM) | Referred children only (PII visible for referred cases) | Update referral outcomes, add clinical notes | Referral-related alerts | Referral queue |

## 4.2 AWW Dashboard

**Components visible** (adapted from existing):
1. **Daily Task Queue** (NEW): Auto-prioritized list of today's actions — home visits, assessments due, follow-ups. Risk-colored badges (red/amber/green). Tap to navigate to child profile.
2. **KPICards** (existing [KPICards.tsx](src/components/dashboard/KPICards.tsx)): Simplified — total children, high-risk count, tasks completed today, sync status.
3. **Child List** (from [ChildProfile.tsx](src/components/dashboard/ChildProfile.tsx)): Sort by risk level (High first), filter by village. Tap for full profile.
4. **Assessment Form** (NEW): Milestone checklist (tap-based, not free text), growth measurement input, behavioral observation. Pre-filled with child demographics.
5. **Intervention View** (from [InterventionEngine.tsx](src/components/dashboard/InterventionEngine.tsx)): Current activities for selected child, compliance logging.

**Components hidden from AWW**: FieldAnalytics (peer comparison could demotivate), DataGovernance, LongitudinalImpact (too complex), district/state analytics.

**Design specifications for AWW view**:
- Minimum font size: 16sp (current codebase uses 10-11px — requires update)
- Tap targets: 48×48dp minimum (current sidebar buttons ~36dp — requires update)
- Navigation: Bottom tab bar with 4 icons: Home (task list), Children (list), Assess (form), Me (profile/sync)
- Color coding: Red = High risk / urgent. Amber = Medium risk / attention. Green = Low risk / on track.
- Offline indicator: Persistent top banner when offline — "Offline Mode — data will sync when connected" in regional language

## 4.3 Supervisor Dashboard

**Components visible**:
1. **Coverage Map** (from [FieldAnalytics.tsx](src/components/dashboard/FieldAnalytics.tsx)): AWC-level heatmap by risk concentration. Color intensity = % high-risk children.
2. **High-Risk Queue**: List of P1/P2 alerts from all AWCs in sector. Tap to review child profile + AWW notes.
3. **AWW Performance** (from [FieldAnalytics.tsx](src/components/dashboard/FieldAnalytics.tsx)): Visit compliance %, assessment completion %, intervention coverage per AWW. Sparklines for trend.
4. **Data Quality Monitor** (NEW): Incomplete assessments, unusual scoring patterns, sync failure rates per AWW.
5. **All existing dashboard components**: KPICards, RiskDistribution, PredictiveInsights, ChildProfile, InterventionEngine, CaregiverEngagement, LongitudinalImpact.

## 4.4 CDPO Dashboard

**Components visible** (all existing components + aggregations):
1. **District Risk Distribution** (existing [RiskDistribution.tsx](src/components/dashboard/RiskDistribution.tsx)): Donut chart (Low/Medium/High) at district level.
2. **Trend Charts** (existing [LongitudinalImpact.tsx](src/components/dashboard/LongitudinalImpact.tsx)): Month-over-month risk category changes.
3. **Top 10 High-Risk Clusters**: Mandals/sectors with highest concentration of high-risk children.
4. **AWW/Supervisor Performance Summaries**: Aggregated performance metrics.
5. **Government Report Export**: One-click export to ICDS MIS format (Excel/PDF).

## 4.5 State Admin Dashboard

1. **State → District → Mandal → Village drill-down**: Choropleth map with zoom. Click district for mandal view.
2. **Comparative Heatmaps**: Risk prevalence across districts, color-coded.
3. **Program KPI Tracking**: Coverage %, detection rate %, intervention rate %, improvement rate % vs national targets.
4. **Anomaly Alerts**: Auto-generated when a district's risk distribution shifts > 10% month-over-month.
5. **Model Management** (NEW): View current model version, validation metrics, approve new deployments.

## 4.6 Key Visualizations

| Visualization | Chart Type | Data Source | Update Frequency | Filter Options |
|---|---|---|---|---|
| Risk Distribution | Donut chart + stacked bar | risk_profiles | Real-time | Mandal, district, age band, gender |
| Geographic Heatmap | Choropleth (district polygons) | analytics aggregation | Daily batch | Risk category, time period |
| Longitudinal Trend | Line chart (time-series) | assessments (longitudinal) | On new assessment | Per child, per cohort, per domain |
| Alert Queue | Ranked list with severity badges | intelligent_alerts | Real-time | Severity, domain, status, AWC |
| Intervention Compliance | Heat calendar (GitHub-style) | intervention_compliance | Daily | Per child, per AWW, per domain |
| AWW Performance | Sparklines + bar chart | field metrics | Weekly batch | Per AWW, per sector |
| Domain Radar | Spider/radar chart | child DQ scores | Per assessment | Per child |

All visualizations use Recharts (already a dependency). Maps require Leaflet.js or MapboxGL (new dependency, ~150KB).

## 4.7 Offline-First UX Strategy

**Screens that must work 100% offline**:
- Daily task list (pre-computed and cached)
- Child list for AWW's AWC
- Individual child profile
- Assessment form (with local validation + local risk scoring)
- Intervention activities for active children (content pre-cached)
- Historical assessment data for AWW's children

**Sync status communication**:
- Top bar: Last synced timestamp + pending mutations count
- Color: Green (synced < 1 hour ago), Amber (synced 1-24 hours ago), Red (synced > 24 hours ago or > 10 pending mutations)
- Manual sync button always visible in profile/settings

**Conflict resolution UX** (supervisor):
- When two records conflict, show side-by-side comparison
- Highlight differing fields in amber
- Supervisor selects canonical version or creates merged version
- Resolution logged in audit trail

## 4.8 Low-Literacy & Accessibility Design

- **Icon-first UI**: Every navigation item, action button, and status indicator has a primary icon. Text labels are secondary, positioned below icons.
- **Voice instruction**: Key screens have a "speaker" icon. Tapping it reads the screen content aloud via Web Speech API (`window.speechSynthesis`) in the user's selected language.
- **Color + shape coding**: Risk levels use color AND shape: Red circle = High, Amber triangle = Medium, Green square = Low. Never rely on color alone (color blindness accommodation).
- **Minimum tap target**: 48×48dp (Material Design guideline). Current codebase buttons must be resized.
- **Multilingual**: Language detection from user profile. Switch available in settings. Phase 1: Telugu + English. All UI strings externalized to i18n JSON files (react-i18next).
- **Screen reader**: Semantic HTML with ARIA labels on all interactive elements. Already partially supported by Radix UI (accessibility-first library).

## 4.9 Alert Prioritization Logic

```
P1 — Critical (respond within 24 hours):
    Conditions:
    - composite_dq < 60
    - autism_risk == "High" AND age_months < 36 (early intervention window)
    - num_delays >= 3 (global developmental delay)
    - nutrition_score >= 5 (severe malnutrition)
    - developmental_regression detected (DQ decline > 5 points)
    Routing: AWW (FCM push) + Supervisor (SMS) + CDPO (WhatsApp)
    Escalation: Unacknowledged at +4h → repeat. +12h → CDPO call. +24h → State dashboard.

P2 — High (respond within 72 hours):
    Conditions:
    - Any single domain DQ < 70
    - Cluster risk concentration > 15% high-risk in mandal
    - Referral pending > 14 days
    - Intervention non-compliance > 4 weeks
    Routing: AWW (in-app) + Supervisor (daily digest)
    Escalation: Unacknowledged at +48h → Supervisor push notification.

P3 — Moderate (respond within 7 days):
    Conditions:
    - Any single domain DQ 70-75
    - engagement_score < 30
    - Missed scheduled follow-up
    - Assessment overdue > 30 days
    Routing: AWW (in-app task list only)
    Escalation: Unacknowledged at +7d → upgrade to P2.

Alert fatigue mitigation:
    - Maximum 10 alerts per AWW per day (batch remaining into "See N more")
    - P3 alerts batched into daily morning summary (8am)
    - Duplicate suppression: same child + same domain + same severity within 7 days → merge
    - Snooze: AWW can snooze P3 alerts for 48h (max 2 snoozes before auto-escalation)
```

---

# DIMENSION 5 — GOVERNANCE + COMPLIANCE ARCHITECTURE

## 5.1 Data Ownership Model

- **Child record + assessment data**: Owned by State ICDS Directorate (Data Fiduciary under DPDP Act)
- **AI risk scores + contributing factors**: Owned by system operator (Data Processor), stored under government custody
- **Intervention content library**: Owned by content creator (government or contracted NGO)
- **Aggregated analytics**: Owned by government at each administrative level
- **Data localization**: All PII stored in India (NIC cloud). No cross-border transfer. District-level data stays on state servers. National level receives anonymized aggregates only.
- **Legal basis**: Government function exemption under DPDP Act Section 7(b) — processing necessary for provision of government services. Consent still collected for transparency and trust.

## 5.2 Consent Architecture

```
Consent collection flow:
    1. AWW visits family for child registration
    2. AWW taps "Register New Child" → consent screen appears
    3. AWW plays pre-recorded consent explanation audio (90 seconds, regional language):
       "We are recording your child's growth and development information
        to help identify if your child needs extra support. This information
        will be kept private and used only by health workers and government
        programs. You can ask us to stop collecting this information at any time."
    4. Consent recording:
       a. Literate caregiver: Digital signature on screen
       b. Semi-literate: Thumbprint via device camera capture
       c. Illiterate: Verbal consent — AWW taps "Verbal Consent Given",
          enters own user_id as witness. System records: consent_method = "verbal_witnessed"
    5. Three separate consent types recorded:
       - data_collection: basic registration and assessment (REQUIRED for enrollment)
       - ai_processing: risk scoring and intervention recommendations (OPT-IN)
       - data_sharing: sharing with health facilities for referrals (OPT-IN)
    6. Consent stored in consent_records table with:
       - consent_id, caregiver_id, child_id, consent_type, consent_given
       - consent_method, witness_user_id, valid_from, valid_until
    7. Consent validity: 1 year, renewable at annual re-registration
    8. Revocation: Caregiver requests via AWW → AWW records revocation →
       System sets revoked_at → Data anonymization cascade triggered within 30 days
       (child record anonymized, assessments de-identified, interventions stopped)
```

## 5.3 Role-Based Access Control (RBAC)

**Permission matrix**:

| Data Type / Action | AWW | Supervisor | CDPO | State Admin | Health Worker |
|---|---|---|---|---|---|
| Child PII (name, DOB) — Read | Own AWC | Sector | NO (masked) | NO | Referred only |
| Child PII — Write | Create + edit own | Edit any in scope | NO | NO | NO |
| Assessment data — Read | Own AWC | Sector | District (aggregated) | State (aggregated) | Referred only |
| Assessment data — Write | Create for own AWC | NO | NO | NO | Add clinical notes |
| Risk scores — Read | Own AWC | Sector | District | State | Referred only |
| Risk scores — Override | NO | YES (with justification) | NO | NO | NO |
| Alerts — Read | Own (P1-P3) | Sector (P1-P2) | District (P1) | State (P1) | Referral alerts |
| Alerts — Acknowledge | Own P3 | Own P2 + escalated | Own P1 | System-level | Referral-related |
| Interventions — Read | Own AWC | Sector | District (aggregated) | State (aggregated) | Referred only |
| Interventions — Modify | Log compliance | Override plan | NO | NO | NO |
| Referrals — Create | YES | YES | YES | NO | YES |
| Referrals — Update status | YES (own) | YES (sector) | YES (district) | NO | YES (assigned) |
| Audit logs — Read | NO | NO | Own district | YES | NO |
| Data export — Raw | NO | NO | NO | NO | NO |
| Data export — Anonymized | NO | NO | YES (own district) | YES | NO |
| User management | NO | NO | AWWs in scope | CDPOs + below | NO |
| Model management | NO | NO | NO | YES (approve deployments) | NO |

**Field-level access control** (implemented via PostgreSQL views + API middleware):
```sql
-- View for CDPO role: child name masked
CREATE VIEW children_cdpo AS
SELECT
    child_id,
    CONCAT('Child-', RIGHT(child_id, 4)) AS display_name,  -- masked name
    gender,
    date_part('year', age(dob)) AS age_years,  -- approximate age only
    awc_id,
    is_active
FROM children;
```

**Temporal access control**: User deactivation (`is_active = false`) immediately revokes all access. Role change triggers re-assignment of location scope. Session JWT invalidation via Redis blacklist.

## 5.4 Data Anonymization Strategy

| PII Field | Anonymization Method | Used In |
|---|---|---|
| child_id | Replace with random UUID | Research exports |
| first_name, last_name | Remove entirely | All non-operational contexts |
| dob | Generalize to age_band | Analytics exports |
| contact_number | Remove | All non-operational contexts |
| awc_code | Generalize to mandal if AWC has < 5 children | k-anonymity compliance |
| mandal | Generalize to district if mandal has < 5 children | k-anonymity compliance |
| caregiver name | Remove | All non-operational contexts |

**k-anonymity threshold**: k=5 (minimum 5 children in any quasi-identifier group)

**Re-identification risk**: Annual assessment by data protection officer. Test: can any record be linked back to a specific individual using quasi-identifiers (age, gender, location, assessment scores)? If yes, increase generalization.

## 5.5 Audit Trail Design

```json
// Example audit record
{
    "audit_id": "550e8400-e29b-41d4-a716-446655440000",
    "user_id": "aww_user_123",
    "action": "view_child_profile",
    "resource_type": "child",
    "resource_id": "AP_ECD_000042",
    "ip_address": "10.0.1.15",
    "user_agent": "Mozilla/5.0 (Android 10; ...) Chrome/120",
    "details": {
        "fields_accessed": ["gm_dq", "fm_dq", "risk_category"],
        "data_scope": "own_awc",
        "session_id": "sess_abc123"
    },
    "created_at": "2026-03-22T10:30:00Z"
}
```

**AI decision audit** (in risk_decision_log table):
```json
{
    "child_id": "AP_ECD_000042",
    "model_version": "rule_v1.0",
    "input_features": {
        "gm_delay": 1, "fm_delay": 0, "lc_delay": 1,
        "autism_risk": "Moderate", "nutrition_score": 3
    },
    "output_score": 18,
    "output_category": "Medium",
    "confidence": 91.4,
    "contributing_factors": [
        {"domain": "Gross Motor", "points": 5},
        {"domain": "Language/Communication", "points": 5},
        {"domain": "Autism Risk", "points": 8}
    ]
}
```

**Tamper-proof storage**: Audit table is append-only (no UPDATE/DELETE permissions granted to any application role). PostgreSQL `pg_audit` extension for database-level audit of DDL changes. Daily hash chain: `daily_hash = SHA256(previous_daily_hash + all_audit_records_for_day)` stored in separate tamper-evident log.

## 5.6 DPDP Act 2023 Alignment

| DPDP Obligation | System Control |
|---|---|
| Lawful purpose (Section 4) | Purpose limitation enforced: data used only for ECD monitoring, risk assessment, intervention delivery. API endpoints reject requests outside scope. |
| Consent (Section 6) | consent_records table with granular consent types. Verbal + thumbprint methods for non-literate. |
| Notice (Section 5) | Pre-recorded audio notice in regional language played at registration. Written notice (visual card) left with caregiver. |
| Data minimization (Section 4) | Review of 88-field child record: fields like `mode_conception`, `consanguinity` flagged as sensitive — require explicit additional consent. |
| Right of access (Section 11) | Caregiver can request data printout via AWW. System generates PDF summary of child's records. |
| Right of correction (Section 12) | Caregiver notifies AWW → AWW submits correction → Supervisor approves → record updated with audit trail. |
| Right of erasure (Section 13) | Consent revocation → 30-day anonymization cascade. Automated pipeline removes PII, retains anonymized assessment data for aggregate analytics. |
| Data Fiduciary obligations (Section 8) | State ICDS Directorate registers as Fiduciary. Technical measures: encryption, access control, audit trails. Organizational: DPO appointment, annual compliance audit. |
| Significant Data Fiduciary (Section 10) | Likely applies given scale (children's data, government program). Requirements: Data Protection Impact Assessment, independent audit, DPO appointment. |
| Breach notification (Section 8(6)) | Incident response plan: detect → contain → notify DPB within 72 hours → notify affected caregivers via AWW. See Section 5.10. |

## 5.7 Security Architecture

| Layer | Control | Specification |
|---|---|---|
| Encryption at rest | AES-256 | PostgreSQL `pgcrypto` for column-level encryption of PII (child name, DOB, caregiver contact). Full-disk encryption on NIC cloud VMs. |
| Encryption in transit | TLS 1.3 | Nginx terminates TLS with HSTS header (`max-age=63072000; includeSubDomains`). Certificate via Let's Encrypt or NIC CA. |
| Device security | PWA security | IndexedDB encrypted using `crypto.subtle.encrypt()` with key derived from user password (PBKDF2, 100K iterations). Remote session invalidation via Redis JWT blacklist. |
| Authentication | OAuth 2.0 + JWT | Authorization code flow for initial login. Access tokens: 15-min expiry. Refresh tokens: 7-day expiry, rotated on use. JWT payload: `{user_id, role, location_ids, permissions, exp}` |
| API security | Rate limiting + WAF | Rate limit: 100 req/min per user, 1000 req/min per IP. Nginx WAF rules for SQL injection, XSS. Input validation via Zod on all endpoints. |
| Penetration testing | Annual + pre-launch | OWASP top 10 assessment. CERT-In empanelled auditor. Scope: API endpoints, PWA, database access. |
| Incident response | Defined plan | See Section 5.10 |

## 5.8 Explainable AI Compliance

- **Government requirement**: Every risk classification must have a human-readable explanation of what inputs drove the classification.
- **Implementation**: `contributing_domains` array in risk_profiles (already built in pipeline). Template-based plain language explanation for AWW. SHAP values for ML model (Phase 2).
- **Human override**: Supervisor can override any risk classification via dashboard. Override requires: text justification (minimum 20 characters), auto-logged in audit trail, original AI classification preserved alongside override.
- **Liability framework**: The AI system is an advisory tool — final clinical decisions rest with human professionals (DEIC clinicians, pediatricians). AWWs and supervisors are empowered to override. System clearly labeled: "AI-assisted recommendation — not a clinical diagnosis."
- **Note**: Liability framework requires formal legal opinion from government legal department. Flag for stakeholder discussion.

## 5.9 Data Retention Policy

| Data Type | Active Retention | Archive Retention | Deletion |
|---|---|---|---|
| Active child record | Until age 6 + 2 years (age 8) | Anonymized: 10 years | Auto-delete PII at age 8 |
| Assessment records | Same as child record | Anonymized: 10 years for research | PII deleted with child record |
| Risk scores + AI decisions | Same as child record | Anonymized: 10 years | PII deleted with child record |
| Audit trail | 7 years minimum | Archive to cold storage | Delete after 7 years |
| Consent records | Duration of consent + 3 years | Archive: 10 years | Delete after retention period |
| Caregiver contact info | Until consent revoked or child ages out | Not retained | Immediate delete on revocation |
| Sync logs | 90 days | Not retained | Auto-purge via cron |

**Automated pipeline**: Monthly cron job identifies children who have aged out. Triggers anonymization cascade. Logs completion in audit trail.

## 5.10 Risk Scenarios & Mitigation

**Scenario 1: Mass data breach**
- Detection: Anomalous access patterns (unusual export volume, off-hours access, new IP addresses) → auto-alert to admin
- Containment: Immediate API key rotation. Affected user sessions invalidated. Database access restricted to read-only for non-essential roles.
- Notification: Data Protection Board notified within 72 hours (DPDP mandate). Affected caregivers notified via AWW within 7 days.
- Recovery: Forensic analysis. Patch vulnerability. Full penetration test before restoring services.
- Post-incident: Published incident report (anonymized). Updated security controls.

**Scenario 2: AWW misuse of child records**
- Prevention: API rate limiting on data access. Audit trail on every record view. AWW cannot export or screenshot (PWA security headers + Content-Security-Policy).
- Detection: Unusual access patterns (viewing children outside own AWC, excessive record views).
- Response: Account suspension. Supervisor investigation. Disciplinary action per government HR policy.

**Scenario 3: AI model systematic bias**
- Detection: Monthly fairness audit reveals sensitivity for tribal community children is 72% vs 92% overall.
- Response: Immediate: increase manual review for that subgroup. Retrain model with oversampled tribal community data. Re-validate before redeployment.
- Prevention: Quarterly bias audits, diverse training data, fairness constraints in model training objective.

**Scenario 4: Government data request beyond legal scope**
- Response: Route all data requests through designated Data Protection Officer. DPO evaluates legal basis. Reject requests without proper legal authority. Document all requests and responses.

**Scenario 5: Vendor lock-in**
- Prevention: All infrastructure containerized (Docker). Database is PostgreSQL (open source). No proprietary cloud services in critical path. WhatsApp/SMS gateways abstracted behind notification interface — can swap providers.
- Mitigation: Annual vendor review. Export all data in standard formats (CSV, JSON). Maintain deployment scripts for alternative infrastructure.

---

# DIMENSION 6 — DEPLOYMENT + SCALING STRATEGY

## 6.1 Pilot Rollout Plan

### Selection Criteria for Pilot Mandal
- Mixed connectivity: some areas with 4G, some with 2G-only, some with intermittent coverage
- AWW literacy diversity: mix of digitally comfortable and first-time smartphone users
- District administration buy-in: CDPO actively engaged
- DEIC (District Early Intervention Centre) available for clinical validation
- Geographic: Andhra Pradesh (existing data is from AP — Chittoor, Eluru, Guntur, Visakhapatnam districts)

### Pilot Scope
- **AWWs**: 50 (from ~25 AWCs in 1 mandal)
- **Children**: ~2,000 (40 children per AWW average)
- **Supervisors**: 5-6 (1 per sector)
- **CDPOs**: 1-2
- **Duration**: 6 months

### Pilot Phases
| Phase | Duration | Activities | Success Criteria |
|---|---|---|---|
| Setup | Weeks 1-4 | Infrastructure deployment, data migration, device procurement | System operational, initial data loaded |
| Onboarding | Weeks 5-8 | AWW training (2 days per batch), supervisor training (1 day) | All 50 AWWs registered, logged in at least once |
| Soft Launch | Weeks 9-16 | Supervised usage with daily helpdesk support | DAU > 50%, first assessments entered |
| Full Operation | Weeks 17-24 | Independent usage, data quality monitoring, outcome collection | Assessment coverage > 80%, sync success > 95% |

### Success Criteria to Advance
- AWW daily active usage > 70%
- Assessment completion: ≥ 1 assessment per child per quarter for > 80% of enrolled children
- Mean time from high-risk detection to first intervention: < 48 hours
- Data sync success rate > 95%
- False negative rate (missed high-risk children, validated against clinical assessment): < 10%
- User satisfaction (System Usability Scale): > 65/100

## 6.2 Field Training Strategy

### AWW Training (2 days, 4 hours/day)

**Day 1: Getting Started**
| Module | Duration | Method | Content |
|---|---|---|---|
| App Installation | 30 min | Hands-on, 1:1 support | PWA install via Chrome, home screen shortcut, first login |
| My Dashboard | 30 min | Guided walkthrough | Understanding "My Children" list, color codes, sync status |
| Child Profile | 60 min | Guided + practice | Viewing profiles, understanding radar chart, risk badges |
| Assessment Entry | 120 min | Guided + practice with 3 sample children | Milestone checklist, growth measurement entry, form submission |

**Day 2: Working with the System**
| Module | Duration | Method | Content |
|---|---|---|---|
| Risk & Alerts | 30 min | Guided walkthrough | What red/amber/green means, what to do for each |
| Interventions | 60 min | Guided + role-play | Viewing activity recommendations, demonstrating to caregiver |
| Offline Mode | 30 min | Simulated (airplane mode) | What works offline, how to recognize sync status, manual sync |
| Practice Session | 90 min | Independent practice | Full workflow for 3 children: profile → assess → view risk → view intervention |
| Q&A + Feedback | 30 min | Open discussion | Address concerns, collect initial feedback |

**Training materials**: In-app tutorial mode (guided overlay on each screen). 2-3 minute video tutorials in Telugu accessible from help menu. Laminated quick-reference card (front: navigation icons, back: assessment form fields).

**Refresher**: Monthly 1-hour sessions led by supervisor. Triggered automatically if AWW's data quality score drops below threshold.

### Supervisor Training (1 day)
- Focus: Dashboard interpretation, data quality monitoring, alert review and escalation, AWW performance management
- Method: Classroom with laptops/tablets

### CDPO Training (half day)
- Focus: District analytics interpretation, report generation, policy decision support
- Method: Presentation + hands-on dashboard session

## 6.3 Infrastructure Setup

### Pilot Phase (Single Server)
```
NIC Cloud VM:
  - 4 vCPU, 8GB RAM, 100GB SSD
  - Ubuntu 22.04 LTS
  - Docker Compose:
    - Nginx (reverse proxy, TLS termination)
    - Node.js API (Fastify, 2 instances)
    - Python Risk Engine (FastAPI, 1 instance)
    - PostgreSQL 15 (with daily WAL backup to object storage)
    - Redis 7 (session cache, job queue)
  - Object Storage: NIC S3-compatible for content library + backups
  - Domain: ecd.{state}.gov.in (government domain)
  - SSL: NIC CA or Let's Encrypt
```

### Device Procurement
- **AWW devices**: Android smartphones (≥ Android 8, 3GB RAM, 32GB storage, ~INR 8,000-10,000)
- **Recommended**: Jio Phone Next or Samsung Galaxy A04 (widely available, affordable)
- **SIM**: BSNL or Jio (best rural coverage in AP)
- **MDM**: Google Endpoint Management (free tier) or Scalefusion for device policy enforcement

### Network Configuration
- APN configuration for BSNL/Jio SIMs optimized for low-bandwidth data
- PWA pre-loaded on devices before distribution
- Initial data sync performed over WiFi at training venue

## 6.4 Offline-First Architecture (Technical)

### Client-Side Schema (Dexie.js / IndexedDB)
```typescript
import Dexie from 'dexie';

class ECDLocalDB extends Dexie {
    children!: Table<Child>;
    assessments!: Table<Assessment>;
    riskProfiles!: Table<RiskProfile>;
    alerts!: Table<Alert>;
    interventions!: Table<ChildIntervention>;
    contentCache!: Table<CachedContent>;
    pendingSync!: Table<PendingMutation>;
    syncMeta!: Table<SyncMetadata>;

    constructor() {
        super('ECDLocalDB');
        this.version(1).stores({
            children: 'child_id, awc_code, mandal, computed_risk_category',
            assessments: 'assessment_id, child_id, assessment_date',
            riskProfiles: 'risk_id, child_id, risk_category',
            alerts: 'alert_id, child_id, severity, status',
            interventions: 'child_id',
            contentCache: 'content_id, domain, age_band, offline_priority',
            pendingSync: '++id, table_name, operation, timestamp',
            syncMeta: 'key'  // stores last_sync_timestamp, device_id
        });
    }
}
```

### Sync Protocol Detail
```typescript
async function performSync(): Promise<SyncResult> {
    const db = new ECDLocalDB();
    const lastSync = await db.syncMeta.get('last_sync_timestamp');
    const pending = await db.pendingSync.toArray();

    if (pending.length === 0 && lastSync?.value) {
        // Pull-only sync: check for server changes
        const response = await fetch('/api/v1/sync/pull', {
            method: 'POST',
            body: JSON.stringify({ since: lastSync.value })
        });
        const serverChanges = await response.json();
        await applyServerChanges(db, serverChanges);
        return { type: 'pull', applied: serverChanges.length };
    }

    // Full sync: push mutations + pull changes
    const response = await fetch('/api/v1/sync', {
        method: 'POST',
        body: JSON.stringify({
            mutations: pending.map(p => ({
                table: p.table_name,
                operation: p.operation,
                data: p.payload,
                client_timestamp: p.timestamp
            })),
            last_sync_timestamp: lastSync?.value || null
        })
    });

    const result = await response.json();

    // Clear applied mutations
    const appliedIds = pending.slice(0, result.applied).map(p => p.id);
    await db.pendingSync.bulkDelete(appliedIds);

    // Apply server changes
    await applyServerChanges(db, result.server_changes);

    // Handle conflicts (show in UI for supervisor review)
    if (result.conflicts.length > 0) {
        await db.syncMeta.put({ key: 'conflicts', value: result.conflicts });
    }

    // Update sync timestamp
    await db.syncMeta.put({ key: 'last_sync_timestamp', value: new Date().toISOString() });

    return result;
}
```

### Data Volume Estimates
| Data Type | Per Child | 50 Children | 2000 Children (mandal) |
|---|---|---|---|
| Child record | ~500 bytes | 25 KB | 1 MB |
| Assessment (1 cycle) | ~300 bytes | 15 KB | 600 KB |
| Risk profile | ~200 bytes | 10 KB | 400 KB |
| Alerts (active) | ~150 bytes × avg 2 | 15 KB | 600 KB |
| Intervention plan | ~400 bytes | 20 KB | 800 KB |
| **Total (AWW scope)** | | **~85 KB** | |
| **Total (supervisor scope, ~200 children)** | | **~340 KB** | |
| Content library cache | ~50 MB (audio + images for active interventions) | | |

## 6.5 ICDS System Integration

| System | Integration Method | Data Exchanged | Frequency | Fallback |
|---|---|---|---|---|
| POSHAN Tracker | REST API (if available) | Height, weight, MUAC, feeding practices | Daily sync | Monthly CSV upload by supervisor |
| State HMIS | HL7 FHIR R4 REST | Referral status updates, clinical outcomes | On event (referral status change) | Manual update by health worker via platform |
| Civil Registration | Government API (Aadhaar-linked) | Birth records for new enrollment | Weekly batch | Manual registration by AWW |
| RBSK/DEIC | Referral API or email | Referral notes, clinical assessment results | On event | Physical referral slip + manual data entry |

**Note**: All government API integrations require formal MoU between ICDS Directorate and respective departments. API availability varies by state. Plan for manual fallback in all cases.

## 6.6 Monitoring & Evaluation Framework

### System Health Monitoring
| Metric | Target | Alert Threshold | Tool |
|---|---|---|---|
| API uptime | 99.5% | < 99% over 24h | Uptime Robot / health check endpoint |
| API response time (P95) | < 2s | > 3s | Prometheus + Grafana |
| Sync success rate | > 95% | < 90% over 24h | Custom dashboard from sync_log table |
| Database replication lag | < 5s | > 30s | PostgreSQL monitoring |
| BullMQ queue depth | < 50 | > 200 | Bull Board dashboard |
| Risk scoring latency (P95) | < 30s | > 60s | FastAPI metrics |

### Data Quality Monitoring
| Metric | Target | Action on Breach |
|---|---|---|
| Assessment completeness (% fields filled) | > 85% | Flag AWW for refresher training |
| DQ score range validity (0-200) | 100% | Auto-reject, prompt re-entry |
| Duplicate assessment rate | < 1% | Deduplication pipeline + AWW notification |
| Sync conflict rate | < 2% | Review conflict resolution rules |

### Field Adoption Monitoring
| Metric | Target | Measurement |
|---|---|---|
| Daily Active Users (AWWs) | > 70% of registered | Login events per day |
| Assessments per AWW per quarter | ≥ 1 per child | Assessment count / child count |
| Mean time to first assessment (new child) | < 14 days from registration | registration_date vs first assessment_date |
| Intervention compliance rate | > 60% of assigned activities completed | compliance records / assigned activities |

## 6.7 KPIs & Success Metrics

| KPI | Definition | Target (6 months) | Target (12 months) |
|---|---|---|---|
| Coverage | % enrolled children with ≥ 1 assessment per quarter | 80% | 90% |
| Risk Detection | % high-risk children identified within 30 days of enrollment | 85% | 95% |
| Intervention | % high-risk children with active intervention plan | 90% | 95% |
| Caregiver Engagement | % compliance with recommended activities | 50% | 65% |
| Outcome | % high-risk children showing improvement at 6-month follow-up | 40% | 55% |
| System Uptime | | 99.5% | 99.9% |
| Risk Score Latency | Time from assessment to score available | < 30s (online), < 5s (offline rule-based) | Same |

## 6.8 Scaling Roadmap

### Phase 1 — Pilot (1 mandal, 6 months)
- **Scope**: 50 AWWs, ~2,000 children, 5-6 supervisors, 1 CDPO
- **Infrastructure**: Single NIC cloud VM (Docker Compose)
- **Team**: 2 backend engineers, 1 frontend engineer, 1 ML engineer (part-time), 1 field coordinator, 1 project manager
- **Budget estimate**: INR 25-35 lakhs (cloud: 3L, devices: 5L, personnel: 15L, training: 5L, contingency: 5L)
- **Key risks**: AWW adoption resistance → mitigate with incentive design and champion AWW identification. NIC cloud provisioning delays → have AWS backup ready.

### Phase 2 — District (5 districts, 12 months)
- **Scope**: 2,500 AWWs, ~100,000 children
- **Infrastructure changes**: 3-node PostgreSQL cluster (primary + 2 read replicas). Kubernetes deployment (3 API pods, 2 risk engine pods). CDN for static assets. Separate analytics database (read replica).
- **Team**: +2 backend engineers, +1 DevOps, +1 data engineer, +5 field coordinators, +1 training lead
- **Budget estimate**: INR 1.5-2.5 crores
- **Key risks**: Data quality variance across districts → standardized training program + automated quality checks. Network infrastructure in remote mandals → partner with BSNL for coverage assessment.

### Phase 3 — State (full AP deployment, 18 months)
- **Scope**: ~55,000 AWWs, ~2.2M children (entire Andhra Pradesh)
- **Infrastructure changes**: Multi-AZ PostgreSQL with partitioning by district. Auto-scaling Kubernetes cluster. Dedicated ML training infrastructure. State-level data warehouse for analytics.
- **Team**: +5 engineers, +2 ML engineers, +3 DevOps, +20 field coordinators, +5 trainers
- **Budget estimate**: INR 15-25 crores
- **Key risks**: Political changes affecting program support → embed in existing ICDS budget lines. Scale-related performance issues → load test at 10x expected traffic before launch.

### Phase 4 — National (multi-state replication, 36 months)
- **Scope**: 13.7 lakh AWCs nationally, ~10M+ children across multiple states
- **Infrastructure changes**: Multi-region deployment (one cluster per state or zone). National aggregation service. Multi-language content library. State-specific configuration (different assessment tools, different administrative hierarchies).
- **Team**: Central platform team (15-20 engineers) + state implementation teams (5-10 per state)
- **Budget estimate**: INR 100-200 crores (across all states, over 3 years)
- **Key risks**: State-level variation in ICDS structure → configurable location hierarchy. Vendor sustainability → open-source core, government-owned IP. Political will variation → demonstrate pilot impact data for buy-in.

## 6.9 Adoption Challenges & Mitigation

| Challenge | Mitigation Strategy |
|---|---|
| AWW resistance to digital tools | Champion AWW program: identify tech-savvy AWWs, train them first, use as peer trainers. Gamification: monthly "most improved children" recognition. Reduce, don't add, to workload (auto-generate reports they currently write manually). |
| Supervisor skepticism of AI scores | Show them the formula (transparent rule engine). Allow overrides. Compare AI vs manual over 3 months — track accuracy. |
| Data entry fatigue | Minimize free-text: use checkboxes, dropdowns, tap-based milestone grids. Pre-fill demographics. Assessment should take < 15 minutes. |
| Political resistance at bureaucracy level | Partner with ICDS Directorate from day 1. Frame as "enhancing existing ICDS" not "replacing." Present impact data from pilot. Align with government KPIs (POSHAN Abhiyaan targets). |
| Network/device failure in extreme rural areas | Offline-first architecture handles 7-day gaps. Solar charging kits for power issues. Device insurance/replacement pool (5% spare devices). SMS-based emergency data reporting fallback. |

---

# DIMENSION 7 — AUTOMATION + SYSTEM INTELLIGENCE LAYER

## 7.1 Automated Risk Scoring Pipeline

```
TRIGGER: assessment record inserted (via API or sync)
    │
    ▼
[BullMQ Job: risk.score] (SLA: < 30 seconds)
    │
    ├── Step 1: Validate assessment completeness
    │   IF < 3 domain scores: mark "insufficient_data", skip scoring
    │
    ├── Step 2: Extract features from assessment + child record
    │   - 5 DQ scores, 5 delay flags, 3 neuro-behavioral risk levels
    │   - nutrition_score, composite_dq
    │   - Previous assessment data (for longitudinal features)
    │
    ├── Step 3: Apply rule-based scoring
    │   - Exact formula from process_data.py lines 252-293
    │   - Compute confidence from data completeness
    │
    ├── Step 4: IF ML model deployed → call FastAPI /score endpoint
    │   - Compute hybrid: α × rule_score + (1-α) × ml_score
    │   - If ML endpoint fails: use rule-based only (fallback)
    │
    ├── Step 5: Classify: Low (≤10) / Medium (11-25) / High (>25)
    │   - Apply override rules (autism High → min Medium, etc.)
    │
    ├── Step 6: Store in risk_profiles table
    │   - Also store in risk_decision_log (audit)
    │
    └── Step 7: Emit event: risk.scored → triggers alert generation

FAILURE HANDLING:
    - Job timeout (60s): retry up to 3 times with backoff
    - DB write failure: retry with backoff, alert admin on 3rd failure
    - ML model failure: fall back to rule-based (logged as degraded scoring)
```

## 7.2 Automated Alert Generation

```
TRIGGER: risk.scored event
    │
    ▼
[BullMQ Job: alert.generate] (SLA: < 10 seconds after scoring)
    │
    ├── Step 1: Check domain-specific alerts
    │   FOR each domain in [GM, FM, LC, COG, SE]:
    │     IF dq < 75 AND dq > 0:
    │       severity = "critical" if dq < 60, "high" if dq < 70, "moderate" otherwise
    │       CREATE alert
    │
    ├── Step 2: Check neuro-behavioral alerts
    │   IF autism_risk == "High": CREATE P1 alert
    │   IF num_delays >= 3: CREATE P1 alert (global delay)
    │
    ├── Step 3: Check nutrition alerts
    │   IF nutrition_score >= 5: CREATE P2 alert (severe malnutrition)
    │
    ├── Step 4: Check longitudinal alerts (if ≥ 2 assessments exist)
    │   Stagnation detection: composite_dq change < 2.0 over ≥ 3 months
    │   Regression detection: composite_dq change < -5.0
    │   Anomaly detection: |domain_dq_zscore| > 2.5
    │
    ├── Step 5: Deduplication
    │   FOR each new alert:
    │     IF existing active alert for same child + same domain + same severity + within 7 days:
    │       MERGE (update timestamp, keep existing alert_id)
    │     ELSE:
    │       INSERT new alert
    │
    └── Step 6: Emit event: alert.created → triggers notification dispatch
```

## 7.3 Automated Intervention Updates

```
TRIGGER: risk.scored event (after new assessment)
    │
    ▼
[BullMQ Job: intervention.update]
    │
    ├── Step 1: Get current active intervention plan for child
    │
    ├── Step 2: Compare new risk profile vs previous
    │   IF risk_category changed OR domain deficits changed:
    │     │
    │     ├── IF improved (High → Medium, or Medium → Low):
    │     │   De-escalate: reduce frequency, add next-level activities
    │     │   Status: "adjusted_positive"
    │     │
    │     ├── IF unchanged for ≥ 3 months:
    │     │   Escalate: increase frequency, flag for supervisor
    │     │   Status: "escalated"
    │     │
    │     └── IF worsened:
    │         Immediate: generate P1 alert, intensify all activities
    │         Status: "critical_adjustment"
    │
    ├── Step 3: Generate updated plan (same logic as initial plan)
    │
    ├── Step 4: Store updated plan, close old plan
    │
    └── Step 5: Notify AWW and caregiver of plan change
        - AWW: in-app notification with change summary
        - Caregiver: WhatsApp message with new activity instructions
```

## 7.4 Notification System

```
[Alert/Event]
    │
    ▼
[Notification Router] (BullMQ Job)
    │
    ├── Determine channel based on:
    │   - Alert priority (P1 → multi-channel, P3 → in-app only)
    │   - Recipient role (AWW → FCM, Supervisor → SMS, CDPO → WhatsApp)
    │   - Time of day (no push notifications between 9pm-7am except P1)
    │   - User preferences (opt-out for specific channels)
    │
    ├── FCM (Firebase Cloud Messaging)
    │   - Service: Firebase Admin SDK (Node.js)
    │   - Cost: Free
    │   - Use for: All AWW alerts, real-time push
    │   - Requires: Firebase project, device registration token stored per user
    │
    ├── WhatsApp Business API
    │   - Provider: Gupshup or Twilio (requires vendor contract)
    │   - Cost: ~INR 4/message (template messages)
    │   - Use for: Caregiver activity reminders, CDPO alerts
    │   - Requires: Pre-approved message templates, business verification
    │   - Cadence: Weekly caregiver reminder (Monday 9am), mid-week check-in (Thursday 6pm)
    │
    ├── SMS Gateway
    │   - Provider: MSG91 or Kaleyra
    │   - Cost: ~INR 0.20/SMS
    │   - Use for: Supervisor alerts, SMS fallback when WhatsApp fails
    │   - Requires: DLT registration (mandatory in India), pre-approved templates
    │
    ├── IVR (Interactive Voice Response)
    │   - Provider: Exotel or Ozonetel
    │   - Cost: ~INR 1.50/minute
    │   - Use for: P1 alerts to caregivers without smartphones
    │   - Pre-recorded audio in regional language
    │
    └── In-App (always)
        - Stored in notifications table
        - Badge count on app icon
        - Notification center in sidebar

Notification opt-out and frequency controls:
    - AWWs cannot opt out of P1 alerts
    - Caregivers can opt out of all digital communication (reverts to AWW verbal)
    - Daily cap: 5 push notifications per AWW (except P1)
    - Weekly cap: 3 WhatsApp messages per caregiver
```

## 7.5 Workflow Automation for AWWs

```python
# Daily task generator (BullMQ scheduled job, runs at 6:00 AM daily)
def generate_daily_tasks(aww_id):
    tasks = []
    children = get_children_for_aww(aww_id)
    today = date.today()

    # Priority 1: Urgent alerts (P1) — must address today
    p1_alerts = get_active_alerts(aww_id, severity='critical', status='active')
    for alert in p1_alerts:
        tasks.append(Task(
            type="urgent_alert",
            child_id=alert.child_id,
            priority=1,
            description=alert.message,
            action=alert.suggested_action
        ))

    # Priority 2: Home visits due (high-risk children not visited in 14 days)
    for child in children:
        if child.risk_category in ('High', 'Medium'):
            if child.last_visit_date < today - timedelta(days=14):
                tasks.append(Task(
                    type="home_visit",
                    child_id=child.child_id,
                    priority=2 if child.risk_category == 'High' else 3,
                    description=f"Home visit due — last visit: {child.last_visit_date}"
                ))

    # Priority 3: Assessments due (quarterly schedule)
    for child in children:
        if child.last_assessment_date < today - timedelta(days=90):
            tasks.append(Task(
                type="assessment_due",
                child_id=child.child_id,
                priority=3,
                description=f"Quarterly assessment overdue — last: {child.last_assessment_date}"
            ))

    # Priority 4: Intervention follow-ups
    active_plans = get_active_interventions(aww_id)
    for plan in active_plans:
        if plan.next_followup_date <= today:
            tasks.append(Task(
                type="intervention_followup",
                child_id=plan.child_id,
                priority=4,
                description=f"Follow up on {plan.domain} intervention"
            ))

    # Priority 5: Referral follow-ups (pending > 7 days)
    pending_referrals = get_pending_referrals(aww_id, older_than_days=7)
    for ref in pending_referrals:
        tasks.append(Task(
            type="referral_followup",
            child_id=ref.child_id,
            priority=5,
            description=f"Referral to {ref.referral_type} pending since {ref.referral_date}"
        ))

    # Sort by priority, save to task queue
    tasks.sort(key=lambda t: t.priority)
    save_daily_tasks(aww_id, today, tasks)

    # Push notification: "You have {len(tasks)} tasks today. {p1_count} urgent."
    if tasks:
        send_fcm(aww_id, f"Today: {len(tasks)} tasks, {len(p1_alerts)} urgent")
```

**Auto-schedule assessment reminders**:
```
Monthly cron: FOR each child WHERE last_assessment > 75 days ago:
    Create reminder task for AWW: "Assessment due in {90 - days_since_last} days"
    At 85 days: Push notification to AWW
    At 95 days: Alert to supervisor (assessment overdue)
```

**Auto-flag incomplete records**:
```
Weekly cron: FOR each child WHERE assessment has < 3 domain scores filled:
    Create task for AWW: "Complete assessment for {child_name} — {missing_fields} missing"
```

## 7.6 Escalation Logic

```
Multi-Level Escalation Tree:

Level 0: Child risk flagged
    → Alert created in intelligent_alerts table
    → Routed based on P1/P2/P3 severity

Level 1: AWW (first responder)
    P1: Notified immediately (FCM push)
    P2: Added to daily task list + in-app alert
    P3: Added to daily task list

    Escalation trigger:
    IF P1 not acknowledged within 4 hours → Level 2
    IF P2 not acknowledged within 48 hours → Level 2
    IF P3 not addressed within 7 days → upgrade to P2

Level 2: Mukhya Sevika (Supervisor)
    Notified via SMS + in-app
    Must review child record and AWW notes

    Escalation trigger:
    IF P1 not resolved within 12 hours → Level 3
    IF P2 not resolved within 72 hours → Level 3

Level 3: CDPO
    Notified via WhatsApp + email
    Must review and decide: additional resources, specialist referral, etc.

    Escalation trigger:
    IF P1 not resolved within 24 hours → Level 4 + auto-generate referral

Level 4: State Admin Dashboard
    Appears on state dashboard anomaly section
    Indicates systemic failure in response chain

Health System Referral:
    TRIGGER: Any of:
    - P1 alert with autism_risk == "High"
    - P1 alert with num_delays >= 3
    - Intervention non-response after 3 months
    - Supervisor manual referral

    ACTION:
    1. Auto-generate referral note (child demographics + risk profile + assessment summary)
    2. AWW confirms referral (human-in-the-loop checkpoint)
    3. Referral sent to DEIC/PHC (via API if available, printed form otherwise)
    4. Follow-up task created: check referral status at 7 days, 14 days, 30 days
    5. Referral outcome tracked: seen/treatment started/closed
```

## 7.7 Reporting Automation

| Report | Frequency | Format | Recipient | Generation |
|---|---|---|---|---|
| AWW Daily Summary | Daily (6 AM) | In-app screen | AWW | Auto-generated from daily task generator |
| Supervisor Weekly Digest | Weekly (Monday 8 AM) | Email + in-app | Supervisor | BullMQ scheduled job |
| Monthly District Report | 1st of month | PDF (auto-generated via Puppeteer) | CDPO | BullMQ scheduled job → object storage → email |
| Quarterly State Report | End of quarter | PDF + Excel + dashboard snapshot | State Admin | BullMQ scheduled job |
| ICDS MIS Format | Monthly | Excel (government template) | CDPO → State | Auto-populate government template fields from analytics |
| Custom Report | On-demand | PDF/Excel | CDPO/State Admin | Report builder UI → BullMQ job → download |

**Government MIS auto-population**: Map ECD platform fields to ICDS monthly progress report (MPR) format. Auto-fill: total children screened, children with delays identified, referrals made, interventions active, children improved.

## 7.8 System Monitoring Automation

```
Health Check Pipeline (runs every 60 seconds):
    │
    ├── API health: GET /api/v1/health → expect 200 within 2s
    ├── DB health: PostgreSQL connection pool utilization, replication lag
    ├── Redis health: PING response time
    ├── Risk Engine health: GET /health on FastAPI service
    ├── BullMQ health: queue depth, failed job count
    │
    ├── IF any check fails:
    │   Severity classification:
    │   - API down: P1 (system-level) → PagerDuty/SMS to on-call engineer
    │   - DB replication lag > 30s: P2 → Slack alert to DevOps
    │   - Queue depth > 200: P2 → auto-scale risk engine pods
    │   - Risk engine down: P2 → fall back to rule-based, alert ML team
    │
    └── Metrics exported to Prometheus → Grafana dashboards:
        - Request rate, error rate, latency percentiles
        - Database connections, query time
        - Sync success/failure rate
        - Risk scoring throughput

Auto-Scaling Triggers (Phase 2+, Kubernetes):
    - API pods: scale out when CPU > 70% for 5 min (min 2, max 10 pods)
    - Risk engine: scale out when queue depth > 100 (min 1, max 5 pods)
    - DB read replicas: add replica when read latency P95 > 500ms

Automated Backups:
    - PostgreSQL WAL archiving: continuous to object storage
    - Full database dump: daily at 2 AM (off-peak)
    - Backup verification: weekly automated restore test to staging environment
    - Retention: 30 days of daily backups, 12 months of monthly backups
```

## 7.9 Data Sync Automation (Offline → Online)

```
Client-Side Sync Scheduler:
    │
    ├── Connectivity Listener (navigator.onLine event)
    │   When online detected after offline period:
    │     IF pendingSync.count() > 0:
    │       Schedule sync in 30 seconds (debounce rapid connectivity changes)
    │
    ├── Periodic Sync (Background Sync API / setInterval fallback)
    │   Every 4 hours if online: check for server changes
    │
    ├── Manual Sync
    │   AWW taps "Sync Now" button → immediate sync attempt
    │   Shows progress: "Syncing... 12/15 records sent"
    │
    └── Sync Status UI:
        - Last synced: "2 hours ago" / "3 days ago" (with color coding)
        - Pending records: "5 assessments waiting to sync"
        - Sync button: always visible in header
        - On sync completion: brief toast notification "Sync complete — 5 records sent"
        - On sync failure: amber banner "Sync failed — will retry automatically"

Server-Side Sync Processing:
    POST /api/v1/sync
    │
    ├── Validate JWT and user scope
    ├── Begin database transaction
    ├── FOR each mutation in request:
    │   ├── Validate data (Zod schema)
    │   ├── Check for conflicts (LWW by timestamp)
    │   ├── Apply mutation or log conflict
    │   └── Record in sync_mutations table
    ├── Compute server changes since client's last_sync_timestamp
    ├── Commit transaction
    ├── Log sync in sync_log table
    └── Return response with applied count, conflicts, server changes

Conflict Detection Rules:
    - Same child, same assessment date, different assessor: CONFLICT → supervisor review
    - Same child, different dates: APPEND (both assessments valid)
    - Same record, same assessor, different timestamps: LWW (latest wins)
    - Child registration: duplicate child_id → REJECT, return existing record
```

## 7.10 Human-in-the-Loop Checkpoints

| Checkpoint | Who Reviews | Trigger | UX Flow | Audit Logging |
|---|---|---|---|---|
| Specialist referral approval | AWW | System generates referral recommendation | Notification → review referral note → tap "Confirm Referral" or "Dismiss with reason" → referral sent to facility | referral_id, confirmed_by, confirmation_time |
| P1 alert action | Supervisor | P1 alert escalated from AWW level | Dashboard alert queue → review child profile + risk details → select action (visit, referral, escalate) → log action taken | alert_id, action_taken, action_by, action_time |
| Risk score override | Supervisor | Supervisor disagrees with AI classification | Child profile → tap "Override Risk" → select new category → enter justification (min 20 chars) → submit | override_id, original_score, new_score, justification, overridden_by |
| District escalation approval | CDPO | Alert escalated to district level | Dashboard → review alert chain → approve/reject escalation → if approved, alert appears on state dashboard | escalation_id, approved_by, approval_time |
| Model update deployment | State Admin | New ML model version ready | Model management screen → view validation metrics + bias audit → compare with current model → tap "Approve Deployment" → blue-green deployment | model_version, approved_by, deployment_time |
| Child record correction | Supervisor | AWW or caregiver requests data correction | Correction request → supervisor reviews original + proposed change → approve/reject → audit trail records both versions | correction_id, original_data, corrected_data, approved_by |
| Consent revocation processing | System + Supervisor | Caregiver requests data deletion | AWW records revocation → supervisor confirms → system triggers 30-day anonymization cascade → audit trail | consent_id, revocation_date, anonymization_completion_date |

---

# IMPLEMENTATION SEQUENCING

| Sprint | Weeks | Focus | Key Deliverables | Critical Files Modified |
|---|---|---|---|---|
| 1-2 | 1-4 | Backend Foundation | Node.js API server, PostgreSQL connection, REST endpoints replacing static JSON, JWT auth + RBAC middleware | New: `server/`, modify: [dataService.ts](src/services/dataService.ts) → API client |
| 3-4 | 5-8 | Offline + Sync | Dexie.js integration, service worker, sync protocol, offline indicator | Modify: [ECDDataContext.tsx](src/contexts/ECDDataContext.tsx), new: `src/sync/` |
| 5-6 | 9-12 | Risk Engine Service | FastAPI microservice porting [process_data.py](scripts/process_data.py) logic, BullMQ job pipeline | New: `risk-engine/`, modify: [process_data.py](scripts/process_data.py) |
| 7-8 | 13-16 | PWA + Mobile UX | PWA manifest, assessment form, AWW-optimized views, i18n | Modify: all dashboard components, new: AssessmentForm |
| 9-10 | 17-20 | Notifications + Automation | FCM, WhatsApp/SMS integration, daily task generator, alert escalation | New: `server/notifications/`, `server/jobs/` |
| 11-12 | 21-24 | Governance + Testing | Consent workflow, audit trail, data anonymization, comprehensive test suite, load testing | Modify: [schema.sql](docs/schema.sql), new: test files |
| 13-14 | 25-28 | Pilot Deployment | NIC cloud deployment, training materials, AWW training | New: `deploy/`, `docs/training/` |

---

# THIRD-PARTY DEPENDENCIES

| Dependency | Purpose | Category | Risk Level | Mitigation |
|---|---|---|---|---|
| Firebase (FCM) | Push notifications | Vendor (Google) | Medium | Can replace with web-push library (self-hosted) |
| Gupshup / Twilio | WhatsApp Business API | Vendor | Medium | Abstract behind notification interface, swappable |
| MSG91 / Kaleyra | SMS gateway | Vendor | Low | Multiple providers available, DLT registration is provider-agnostic |
| Exotel / Ozonetel | IVR calls | Vendor | Low | Limited to P1 caregiver alerts, manual fallback available |
| PostgreSQL 15+ | Primary database | Open source | Very Low | Self-managed or any managed PostgreSQL |
| Redis 7+ | Cache, queues | Open source | Very Low | Self-managed or managed service |
| Dexie.js | IndexedDB wrapper | Open source (NPM) | Very Low | Thin wrapper, replaceable |
| Fastify | Node.js HTTP framework | Open source (NPM) | Very Low | Could swap to Express if needed |
| FastAPI | Python ML serving | Open source (pip) | Very Low | Standard Python ecosystem |
| XGBoost | ML model (Phase 2) | Open source (pip) | Low | scikit-learn fallback |
| Recharts | Data visualization | Open source (NPM, already installed) | Very Low | Existing dependency |
| Leaflet.js | Geographic maps | Open source (NPM) | Low | New dependency, ~150KB |
| Puppeteer | PDF report generation | Open source (NPM) | Low | Alternative: jsPDF |
| NIC Cloud | Hosting | Government | High | Docker containers are cloud-agnostic. AWS Mumbai as backup. |
| BSNL/Jio | Rural connectivity | Telecom | Medium | Offline-first architecture mitigates network dependency |

---

# VERIFICATION PLAN

### How to test end-to-end:

1. **Backend API**: Run integration tests against PostgreSQL test database. Verify all 6 data endpoints return correct data scoped by role.
2. **Risk Scoring**: Port existing `process_data.py` tests — verify 1000-child dataset produces identical risk scores via FastAPI as via Python script.
3. **Offline Sync**: Simulate offline scenario in Chrome DevTools (throttle to offline → enter assessment → restore connectivity → verify sync). Test conflict resolution with 2 concurrent sessions.
4. **PWA**: Lighthouse audit for PWA compliance (score > 90). Test install prompt on Android device. Verify service worker caches app shell.
5. **Notifications**: Test FCM push delivery to Android device. Test WhatsApp template message delivery via sandbox API. Verify alert escalation timeline (mock clock advancement).
6. **RBAC**: Login as each role, verify data scope restrictions. AWW should NOT see other AWCs' children. CDPO should NOT see child names.
7. **Assessment Form**: Enter assessment for test child, verify risk score computed within 30 seconds, alert generated if applicable, intervention plan created.
8. **Load Test**: Simulate 50 concurrent AWWs syncing simultaneously. Verify API response time P95 < 2s, sync success rate > 95%.
9. **Field Validation**: Deploy to 5 test AWWs for 2-week trial. Collect usability feedback. Measure actual assessment completion time (target: < 15 minutes).

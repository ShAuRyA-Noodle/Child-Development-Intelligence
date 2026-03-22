// ECD Intelligence Platform — Audit Trail Service
// Append-only, tamper-proof audit logging for all system actions
// Covers: data access, modifications, AI decisions, consent events

import crypto from "crypto";

// ─── Types ───────────────────────────────────────────────────────────────────

export type AuditAction =
  | "child.create" | "child.read" | "child.update" | "child.delete"
  | "assessment.create" | "assessment.read"
  | "risk_score.compute" | "risk_score.override"
  | "alert.create" | "alert.acknowledge" | "alert.escalate" | "alert.resolve"
  | "intervention.create" | "intervention.update"
  | "consent.grant" | "consent.withdraw"
  | "user.login" | "user.logout" | "user.failed_login"
  | "report.generate" | "report.export"
  | "data.export" | "data.sync"
  | "model.deploy" | "model.retrain"
  | "system.config_change";

export interface AuditEntry {
  audit_id: string;
  timestamp: string;
  user_id: string;
  user_role: string;
  action: AuditAction;
  entity_type: string;
  entity_id: string;
  details: Record<string, unknown>;
  ip_address?: string;
  device_id?: string;
  location_context?: string;
  previous_hash: string;
  entry_hash: string;
}

// ─── Hash Chain for Tamper Detection ────────────────────────────────────────

let lastHash = "GENESIS_0000000000000000";

function computeEntryHash(entry: Omit<AuditEntry, "entry_hash">): string {
  const payload = JSON.stringify({
    audit_id: entry.audit_id,
    timestamp: entry.timestamp,
    user_id: entry.user_id,
    action: entry.action,
    entity_type: entry.entity_type,
    entity_id: entry.entity_id,
    details: entry.details,
    previous_hash: entry.previous_hash,
  });

  return crypto.createHash("sha256").update(payload).digest("hex").substring(0, 32);
}

// ─── Audit Logger ───────────────────────────────────────────────────────────

// In-memory buffer for batch writing (production: write to append-only DB table)
const auditBuffer: AuditEntry[] = [];
const BUFFER_FLUSH_SIZE = 50;

export function createAuditEntry(
  userId: string,
  userRole: string,
  action: AuditAction,
  entityType: string,
  entityId: string,
  details: Record<string, unknown> = {},
  meta?: { ip_address?: string; device_id?: string; location_context?: string },
): AuditEntry {
  const entry: Omit<AuditEntry, "entry_hash"> = {
    audit_id: `aud_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
    timestamp: new Date().toISOString(),
    user_id: userId,
    user_role: userRole,
    action,
    entity_type: entityType,
    entity_id: entityId,
    details,
    ip_address: meta?.ip_address,
    device_id: meta?.device_id,
    location_context: meta?.location_context,
    previous_hash: lastHash,
  };

  const entryHash = computeEntryHash(entry);
  const fullEntry: AuditEntry = { ...entry, entry_hash: entryHash };

  lastHash = entryHash;
  auditBuffer.push(fullEntry);

  // Auto-flush when buffer is full
  if (auditBuffer.length >= BUFFER_FLUSH_SIZE) {
    flushAuditBuffer();
  }

  return fullEntry;
}

// ─── AI Decision Audit ──────────────────────────────────────────────────────

export function auditRiskScoreDecision(
  userId: string,
  childId: string,
  inputs: Record<string, unknown>,
  modelVersion: string,
  riskScore: number,
  riskCategory: string,
  confidence: number,
  contributingFactors: Array<{ domain: string; points: number; reason: string }>,
): AuditEntry {
  return createAuditEntry(userId, "system", "risk_score.compute", "risk_profile", childId, {
    model_version: modelVersion,
    scoring_method: "hybrid_rule_ml",
    inputs_summary: {
      num_domains_assessed: Object.keys(inputs).length,
      age_months: inputs.age_months,
      fields_filled: inputs.fields_filled,
    },
    output: {
      risk_score: riskScore,
      risk_category: riskCategory,
      confidence,
      num_contributing_factors: contributingFactors.length,
      top_factors: contributingFactors.slice(0, 3),
    },
  });
}

export function auditRiskScoreOverride(
  userId: string,
  userRole: string,
  childId: string,
  originalCategory: string,
  overrideCategory: string,
  reason: string,
): AuditEntry {
  return createAuditEntry(userId, userRole, "risk_score.override", "risk_profile", childId, {
    original_category: originalCategory,
    override_category: overrideCategory,
    reason,
    requires_supervisor_approval: userRole === "aww",
  });
}

// ─── Consent Audit ──────────────────────────────────────────────────────────

export function auditConsentGrant(
  userId: string,
  caregiverId: string,
  childId: string,
  consentTypes: string[],
  collectionMethod: "verbal" | "visual" | "written" | "digital",
  witnessId?: string,
): AuditEntry {
  return createAuditEntry(userId, "aww", "consent.grant", "consent_record", childId, {
    caregiver_id: caregiverId,
    consent_types: consentTypes,
    collection_method: collectionMethod,
    witness_id: witnessId,
    dpdp_compliant: true,
  });
}

export function auditConsentWithdrawal(
  userId: string,
  caregiverId: string,
  childId: string,
  consentTypes: string[],
  reason: string,
): AuditEntry {
  return createAuditEntry(userId, "system", "consent.withdraw", "consent_record", childId, {
    caregiver_id: caregiverId,
    withdrawn_types: consentTypes,
    reason,
    data_deletion_triggered: true,
  });
}

// ─── Buffer Management ──────────────────────────────────────────────────────

export function flushAuditBuffer(): AuditEntry[] {
  const entries = [...auditBuffer];
  auditBuffer.length = 0;
  // In production: batch INSERT into audit_trail table (append-only, no UPDATE/DELETE permissions)
  return entries;
}

export function getBufferedEntries(): AuditEntry[] {
  return [...auditBuffer];
}

// ─── Integrity Verification ─────────────────────────────────────────────────

export function verifyAuditChain(entries: AuditEntry[]): {
  valid: boolean;
  broken_at?: number;
  broken_entry?: string;
} {
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];

    // Verify hash
    const { entry_hash, ...rest } = entry;
    const expectedHash = computeEntryHash(rest);

    if (expectedHash !== entry_hash) {
      return { valid: false, broken_at: i, broken_entry: entry.audit_id };
    }

    // Verify chain (previous_hash matches prior entry's hash)
    if (i > 0 && entry.previous_hash !== entries[i - 1].entry_hash) {
      return { valid: false, broken_at: i, broken_entry: entry.audit_id };
    }
  }

  return { valid: true };
}

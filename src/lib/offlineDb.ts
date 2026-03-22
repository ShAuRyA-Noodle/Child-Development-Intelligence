// ECD Intelligence Platform — Offline Database (Dexie.js / IndexedDB)
// Provides local-first storage for all ECD data entities

import Dexie, { type Table } from "dexie";

// ─── Offline Record Interfaces ───────────────────────────────────────────────

export interface OfflineChild {
  child_id: string;
  data: Record<string, unknown>;
  updated_at: string;
  synced: 0 | 1;
}

export interface OfflineAssessment {
  id?: number;
  assessment_id: string;
  child_id: string;
  data: Record<string, unknown>;
  captured_at: string;
  synced: 0 | 1;
}

export interface OfflineRiskScore {
  child_id: string;
  data: Record<string, unknown>;
  computed_at: string;
  synced: 0 | 1;
}

export interface OfflineAlert {
  alert_id: string;
  child_id: string | null;
  data: Record<string, unknown>;
  created_at: string;
  acknowledged: 0 | 1;
  synced: 0 | 1;
}

export interface OfflineIntervention {
  id?: number;
  intervention_id: string;
  child_id: string;
  data: Record<string, unknown>;
  updated_at: string;
  synced: 0 | 1;
}

export interface OfflineInterventionCompliance {
  id?: number;
  compliance_id: string;
  intervention_id: string;
  child_id: string;
  data: Record<string, unknown>;
  logged_at: string;
  synced: 0 | 1;
}

export interface SyncMutation {
  id?: number;
  entity_type: "child" | "assessment" | "alert" | "intervention" | "compliance";
  entity_id: string;
  action: "create" | "update" | "delete";
  payload: Record<string, unknown>;
  created_at: string;
  retries: number;
  status: "pending" | "syncing" | "synced" | "failed";
}

export interface SyncMeta {
  key: string;
  value: string;
}

// ─── Database Definition ─────────────────────────────────────────────────────

class ECDDatabase extends Dexie {
  children!: Table<OfflineChild, string>;
  assessments!: Table<OfflineAssessment, number>;
  riskScores!: Table<OfflineRiskScore, string>;
  alerts!: Table<OfflineAlert, string>;
  interventions!: Table<OfflineIntervention, number>;
  complianceLogs!: Table<OfflineInterventionCompliance, number>;
  syncMutations!: Table<SyncMutation, number>;
  syncMeta!: Table<SyncMeta, string>;

  constructor() {
    super("ECDIntelligencePlatform");

    this.version(1).stores({
      children: "child_id, synced, updated_at",
      assessments: "++id, assessment_id, child_id, synced, captured_at",
      riskScores: "child_id, synced, computed_at",
      alerts: "alert_id, child_id, synced, acknowledged, created_at",
      interventions: "++id, intervention_id, child_id, synced, updated_at",
      complianceLogs: "++id, compliance_id, intervention_id, child_id, synced, logged_at",
      syncMutations: "++id, entity_type, entity_id, status, created_at",
      syncMeta: "key",
    });
  }
}

export const db = new ECDDatabase();

// ─── Helper Functions ────────────────────────────────────────────────────────

export async function getLastSyncTimestamp(): Promise<string | null> {
  const meta = await db.syncMeta.get("last_sync");
  return meta?.value ?? null;
}

export async function setLastSyncTimestamp(ts: string): Promise<void> {
  await db.syncMeta.put({ key: "last_sync", value: ts });
}

export async function getPendingMutationCount(): Promise<number> {
  return db.syncMutations.where("status").equals("pending").count();
}

export async function queueMutation(
  entityType: SyncMutation["entity_type"],
  entityId: string,
  action: SyncMutation["action"],
  payload: Record<string, unknown>,
): Promise<void> {
  await db.syncMutations.add({
    entity_type: entityType,
    entity_id: entityId,
    action,
    payload,
    created_at: new Date().toISOString(),
    retries: 0,
    status: "pending",
  });
}

export async function getPendingMutations(): Promise<SyncMutation[]> {
  return db.syncMutations
    .where("status")
    .equals("pending")
    .sortBy("created_at");
}

export async function markMutationSynced(id: number): Promise<void> {
  await db.syncMutations.update(id, { status: "synced" });
}

export async function markMutationFailed(id: number): Promise<void> {
  const mutation = await db.syncMutations.get(id);
  if (mutation) {
    await db.syncMutations.update(id, {
      status: mutation.retries >= 3 ? "failed" : "pending",
      retries: mutation.retries + 1,
    });
  }
}

export async function clearSyncedMutations(): Promise<void> {
  await db.syncMutations.where("status").equals("synced").delete();
}

export async function getOfflineStorageEstimate(): Promise<{
  children: number;
  assessments: number;
  pendingSync: number;
  estimatedSizeKB: number;
}> {
  const [children, assessments, pendingSync] = await Promise.all([
    db.children.count(),
    db.assessments.count(),
    getPendingMutationCount(),
  ]);

  // Rough estimate: ~2KB per child record, ~1KB per assessment
  const estimatedSizeKB = children * 2 + assessments * 1 + pendingSync * 0.5;

  return { children, assessments, pendingSync, estimatedSizeKB };
}

// ECD Intelligence Platform — Sync Engine
// Handles bidirectional offline ↔ online data synchronization
// Strategy: Last-Write-Wins (LWW) with conflict logging

import {
  db,
  getPendingMutations,
  markMutationSynced,
  markMutationFailed,
  clearSyncedMutations,
  getLastSyncTimestamp,
  setLastSyncTimestamp,
  type SyncMutation,
} from "./offlineDb";
import { api, isOnline } from "./apiClient";

// ─── Sync State ──────────────────────────────────────────────────────────────

export type SyncStatus = "idle" | "syncing" | "error" | "offline";

interface SyncState {
  status: SyncStatus;
  lastSync: string | null;
  pendingCount: number;
  conflictsCount: number;
  error: string | null;
}

let currentState: SyncState = {
  status: "idle",
  lastSync: null,
  pendingCount: 0,
  conflictsCount: 0,
  error: null,
};

const stateListeners: Array<(state: SyncState) => void> = [];

function updateState(partial: Partial<SyncState>): void {
  currentState = { ...currentState, ...partial };
  stateListeners.forEach((fn) => fn(currentState));
}

export function getSyncState(): SyncState {
  return currentState;
}

export function onSyncStateChange(fn: (state: SyncState) => void): () => void {
  stateListeners.push(fn);
  return () => {
    const idx = stateListeners.indexOf(fn);
    if (idx >= 0) stateListeners.splice(idx, 1);
  };
}

// ─── Push: Send local mutations to server ────────────────────────────────────

async function pushMutations(): Promise<number> {
  const pending = await getPendingMutations();
  if (pending.length === 0) return 0;

  // Batch in groups of 50 to limit payload size
  const BATCH_SIZE = 50;
  let totalApplied = 0;
  let totalConflicts = 0;

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);
    const payloads = batch.map((m: SyncMutation) => ({
      entity_type: m.entity_type,
      entity_id: m.entity_id,
      action: m.action,
      payload: m.payload,
      client_timestamp: m.created_at,
    }));

    try {
      const result = await api.pushMutations(payloads);
      totalApplied += result.applied;
      totalConflicts += result.conflicts.length;

      // Mark each mutation as synced
      for (const mutation of batch) {
        if (mutation.id !== undefined) {
          await markMutationSynced(mutation.id);
        }
      }
    } catch (err) {
      // Mark failed mutations for retry
      for (const mutation of batch) {
        if (mutation.id !== undefined) {
          await markMutationFailed(mutation.id);
        }
      }
      throw err;
    }
  }

  // Clean up synced mutations
  await clearSyncedMutations();

  if (totalConflicts > 0) {
    updateState({ conflictsCount: totalConflicts });
  }

  return totalApplied;
}

// ─── Pull: Fetch server changes since last sync ─────────────────────────────

async function pullChanges(): Promise<number> {
  const lastSync = await getLastSyncTimestamp();
  const result = await api.pullChanges(lastSync);

  let appliedCount = 0;

  for (const change of result.changes as Array<{
    entity_type: string;
    entity_id: string;
    action: string;
    data: Record<string, unknown>;
    server_timestamp: string;
  }>) {
    try {
      switch (change.entity_type) {
        case "child":
          if (change.action === "delete") {
            await db.children.delete(change.entity_id);
          } else {
            await db.children.put({
              child_id: change.entity_id,
              data: change.data,
              updated_at: change.server_timestamp,
              synced: 1,
            });
          }
          break;

        case "assessment":
          if (change.action === "delete") {
            await db.assessments
              .where("assessment_id")
              .equals(change.entity_id)
              .delete();
          } else {
            const existing = await db.assessments
              .where("assessment_id")
              .equals(change.entity_id)
              .first();
            if (existing) {
              await db.assessments.update(existing.id!, {
                data: change.data,
                synced: 1,
              });
            } else {
              await db.assessments.add({
                assessment_id: change.entity_id,
                child_id: (change.data.child_id as string) || "",
                data: change.data,
                captured_at: change.server_timestamp,
                synced: 1,
              });
            }
          }
          break;

        case "risk_score":
          await db.riskScores.put({
            child_id: change.entity_id,
            data: change.data,
            computed_at: change.server_timestamp,
            synced: 1,
          });
          break;

        case "alert":
          if (change.action === "delete") {
            await db.alerts.delete(change.entity_id);
          } else {
            await db.alerts.put({
              alert_id: change.entity_id,
              child_id: (change.data.child_id as string) || null,
              data: change.data,
              created_at: change.server_timestamp,
              acknowledged: change.data.status === "acknowledged" ? 1 : 0,
              synced: 1,
            });
          }
          break;

        case "intervention":
          if (change.action === "delete") {
            await db.interventions
              .where("intervention_id")
              .equals(change.entity_id)
              .delete();
          } else {
            const existingInt = await db.interventions
              .where("intervention_id")
              .equals(change.entity_id)
              .first();
            if (existingInt) {
              await db.interventions.update(existingInt.id!, {
                data: change.data,
                synced: 1,
              });
            } else {
              await db.interventions.add({
                intervention_id: change.entity_id,
                child_id: (change.data.child_id as string) || "",
                data: change.data,
                updated_at: change.server_timestamp,
                synced: 1,
              });
            }
          }
          break;
      }
      appliedCount++;
    } catch (err) {
      console.error(`Failed to apply change for ${change.entity_type}/${change.entity_id}:`, err);
    }
  }

  await setLastSyncTimestamp(result.server_time);
  return appliedCount;
}

// ─── Full Sync Cycle ─────────────────────────────────────────────────────────

let syncInProgress = false;

export async function performSync(): Promise<{
  pushed: number;
  pulled: number;
}> {
  if (syncInProgress) {
    return { pushed: 0, pulled: 0 };
  }

  if (!isOnline()) {
    updateState({ status: "offline" });
    return { pushed: 0, pulled: 0 };
  }

  syncInProgress = true;
  updateState({ status: "syncing", error: null });

  try {
    // Push first, then pull (ensures server has latest before we pull)
    const pushed = await pushMutations();
    const pulled = await pullChanges();

    const lastSync = await getLastSyncTimestamp();
    const pendingCount = (await getPendingMutations()).length;

    updateState({
      status: "idle",
      lastSync,
      pendingCount,
    });

    return { pushed, pulled };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Sync failed";
    updateState({ status: "error", error: errorMessage });
    throw err;
  } finally {
    syncInProgress = false;
  }
}

// ─── Auto-Sync Scheduler ────────────────────────────────────────────────────

let autoSyncInterval: ReturnType<typeof setInterval> | null = null;

export function startAutoSync(intervalMs: number = 5 * 60 * 1000): void {
  stopAutoSync();

  // Sync immediately on start
  performSync().catch(console.error);

  // Then on interval
  autoSyncInterval = setInterval(() => {
    performSync().catch(console.error);
  }, intervalMs);

  // Also sync when coming back online
  window.addEventListener("online", handleOnline);
}

export function stopAutoSync(): void {
  if (autoSyncInterval) {
    clearInterval(autoSyncInterval);
    autoSyncInterval = null;
  }
  window.removeEventListener("online", handleOnline);
}

function handleOnline(): void {
  // Delay slightly to let connection stabilize
  setTimeout(() => {
    performSync().catch(console.error);
  }, 2000);
}

// ─── Initialize sync state ──────────────────────────────────────────────────

export async function initSyncState(): Promise<void> {
  const lastSync = await getLastSyncTimestamp();
  const pendingCount = (await getPendingMutations()).length;
  updateState({
    status: isOnline() ? "idle" : "offline",
    lastSync,
    pendingCount,
  });
}

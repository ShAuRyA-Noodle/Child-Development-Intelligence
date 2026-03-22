// ECD Intelligence System — Data Service
// Hybrid: tries API first, falls back to offline IndexedDB, then static JSON

import type {
  Child, RiskScore, Alert, ChildIntervention,
  Analytics, LongitudinalData,
} from "@/types/ecd";
import { db, queueMutation } from "@/lib/offlineDb";
import { api, isOnline } from "@/lib/apiClient";

const DATA_BASE = "/data";

// ─── Static JSON Fallback ────────────────────────────────────────────────────

async function fetchJSON<T>(filename: string): Promise<T> {
  const response = await fetch(`${DATA_BASE}/${filename}`);
  if (!response.ok) {
    throw new Error(`Failed to load ${filename}: ${response.statusText}`);
  }
  return response.json();
}

// ─── Offline DB Helpers ──────────────────────────────────────────────────────

async function getChildrenFromDb(): Promise<Child[]> {
  const records = await db.children.toArray();
  return records.map((r) => r.data as unknown as Child);
}

async function getRiskScoresFromDb(): Promise<RiskScore[]> {
  const records = await db.riskScores.toArray();
  return records.map((r) => r.data as unknown as RiskScore);
}

async function getAlertsFromDb(): Promise<Alert[]> {
  const records = await db.alerts.toArray();
  return records.map((r) => r.data as unknown as Alert);
}

async function getInterventionsFromDb(): Promise<ChildIntervention[]> {
  const records = await db.interventions.toArray();
  return records.map((r) => r.data as unknown as ChildIntervention);
}

// ─── Data Loading with Cascading Fallback ────────────────────────────────────

type DataSource = "api" | "offline" | "static";

interface LoadResult<T> {
  data: T;
  source: DataSource;
}

async function loadWithFallback<T>(
  apiFn: () => Promise<T>,
  offlineFn: () => Promise<T>,
  staticFn: () => Promise<T>,
): Promise<LoadResult<T>> {
  // Try API first if online
  if (isOnline()) {
    try {
      const data = await apiFn();
      return { data, source: "api" };
    } catch {
      // Fall through to offline
    }
  }

  // Try offline DB
  try {
    const data = await offlineFn();
    if (data && (Array.isArray(data) ? data.length > 0 : true)) {
      return { data, source: "offline" };
    }
  } catch {
    // Fall through to static
  }

  // Final fallback: static JSON
  const data = await staticFn();
  return { data, source: "static" };
}

// ─── Public Data Service ─────────────────────────────────────────────────────

export const dataService = {
  async loadChildren(): Promise<Child[]> {
    const result = await loadWithFallback<Child[]>(
      async () => {
        const res = await api.getChildren();
        return res.data as unknown as Child[];
      },
      getChildrenFromDb,
      () => fetchJSON<Child[]>("children.json"),
    );

    // Cache API results to offline DB
    if (result.source === "api") {
      for (const child of result.data) {
        await db.children.put({
          child_id: child.child_id,
          data: child as unknown as Record<string, unknown>,
          updated_at: new Date().toISOString(),
          synced: 1,
        });
      }
    }

    return result.data;
  },

  async loadRiskScores(): Promise<RiskScore[]> {
    const result = await loadWithFallback<RiskScore[]>(
      async () => api.getRiskScores() as Promise<RiskScore[]>,
      getRiskScoresFromDb,
      () => fetchJSON<RiskScore[]>("risk_scores.json"),
    );

    if (result.source === "api") {
      for (const rs of result.data) {
        await db.riskScores.put({
          child_id: rs.child_id,
          data: rs as unknown as Record<string, unknown>,
          computed_at: new Date().toISOString(),
          synced: 1,
        });
      }
    }

    return result.data;
  },

  async loadAlerts(): Promise<Alert[]> {
    const result = await loadWithFallback<Alert[]>(
      async () => api.getAlerts() as Promise<Alert[]>,
      getAlertsFromDb,
      () => fetchJSON<Alert[]>("alerts.json"),
    );

    if (result.source === "api") {
      for (const alert of result.data) {
        await db.alerts.put({
          alert_id: alert.alert_id,
          child_id: alert.child_id,
          data: alert as unknown as Record<string, unknown>,
          created_at: new Date().toISOString(),
          acknowledged: 0,
          synced: 1,
        });
      }
    }

    return result.data;
  },

  async loadInterventions(): Promise<ChildIntervention[]> {
    const result = await loadWithFallback<ChildIntervention[]>(
      async () => api.getInterventions("") as Promise<ChildIntervention[]>,
      getInterventionsFromDb,
      () => fetchJSON<ChildIntervention[]>("interventions.json"),
    );

    return result.data;
  },

  async loadAnalytics(): Promise<Analytics> {
    const result = await loadWithFallback<Analytics>(
      async () => api.getAnalytics() as Promise<Analytics>,
      // Analytics not cached offline — fall through
      async () => { throw new Error("no cache"); },
      () => fetchJSON<Analytics>("analytics.json"),
    );

    return result.data;
  },

  async loadLongitudinal(): Promise<LongitudinalData> {
    const result = await loadWithFallback<LongitudinalData>(
      async () => api.getLongitudinalData() as Promise<LongitudinalData>,
      async () => { throw new Error("no cache"); },
      () => fetchJSON<LongitudinalData>("longitudinal.json"),
    );

    return result.data;
  },

  async loadAll() {
    const [children, riskScores, alerts, interventions, analytics, longitudinal] =
      await Promise.all([
        this.loadChildren(),
        this.loadRiskScores(),
        this.loadAlerts(),
        this.loadInterventions(),
        this.loadAnalytics(),
        this.loadLongitudinal(),
      ]);
    return { children, riskScores, alerts, interventions, analytics, longitudinal };
  },

  // ─── Write Operations (queue offline mutations) ──────────────────────────

  async createAssessment(childId: string, assessmentData: Record<string, unknown>): Promise<void> {
    const assessmentId = `assess_${childId}_${Date.now()}`;

    // Store locally
    await db.assessments.add({
      assessment_id: assessmentId,
      child_id: childId,
      data: { ...assessmentData, child_id: childId, assessment_id: assessmentId },
      captured_at: new Date().toISOString(),
      synced: 0,
    });

    // Queue for sync
    await queueMutation("assessment", assessmentId, "create", {
      ...assessmentData,
      child_id: childId,
      assessment_id: assessmentId,
    });

    // Try immediate API push if online
    if (isOnline()) {
      try {
        await api.createAssessment({ ...assessmentData, child_id: childId });
      } catch {
        // Queued mutation will handle it later
      }
    }
  },

  async acknowledgeAlert(alertId: string): Promise<void> {
    // Update locally
    await db.alerts.update(alertId, { acknowledged: 1 });

    // Queue for sync
    await queueMutation("alert", alertId, "update", { status: "acknowledged" });

    if (isOnline()) {
      try {
        await api.acknowledgeAlert(alertId);
      } catch {
        // Will sync later
      }
    }
  },

  async logCompliance(
    interventionId: string,
    childId: string,
    complianceData: Record<string, unknown>,
  ): Promise<void> {
    const complianceId = `comp_${interventionId}_${Date.now()}`;

    await db.complianceLogs.add({
      compliance_id: complianceId,
      intervention_id: interventionId,
      child_id: childId,
      data: complianceData,
      logged_at: new Date().toISOString(),
      synced: 0,
    });

    await queueMutation("compliance", complianceId, "create", {
      ...complianceData,
      intervention_id: interventionId,
      child_id: childId,
    });

    if (isOnline()) {
      try {
        await api.logCompliance(interventionId, complianceData);
      } catch {
        // Will sync later
      }
    }
  },
};

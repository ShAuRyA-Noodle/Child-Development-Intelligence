// ECD Intelligence System — Data Service
// Loads JSON data files produced by the data pipeline

import type {
    Child, RiskScore, Alert, ChildIntervention,
    Analytics, LongitudinalData,
} from "@/types/ecd";

const DATA_BASE = "/data";

async function fetchJSON<T>(filename: string): Promise<T> {
    const response = await fetch(`${DATA_BASE}/${filename}`);
    if (!response.ok) {
        throw new Error(`Failed to load ${filename}: ${response.statusText}`);
    }
    return response.json();
}

export const dataService = {
    async loadChildren(): Promise<Child[]> {
        return fetchJSON<Child[]>("children.json");
    },

    async loadRiskScores(): Promise<RiskScore[]> {
        return fetchJSON<RiskScore[]>("risk_scores.json");
    },

    async loadAlerts(): Promise<Alert[]> {
        return fetchJSON<Alert[]>("alerts.json");
    },

    async loadInterventions(): Promise<ChildIntervention[]> {
        return fetchJSON<ChildIntervention[]>("interventions.json");
    },

    async loadAnalytics(): Promise<Analytics> {
        return fetchJSON<Analytics>("analytics.json");
    },

    async loadLongitudinal(): Promise<LongitudinalData> {
        return fetchJSON<LongitudinalData>("longitudinal.json");
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
};

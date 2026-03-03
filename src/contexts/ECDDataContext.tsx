import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from "react";
import { dataService } from "@/services/dataService";
import type {
    Child, RiskScore, Alert, ChildIntervention,
    Analytics, LongitudinalData, RoleType,
} from "@/types/ecd";

interface ECDFilters {
    mandal: string;        // "All" or specific mandal
    role: RoleType;
    dateRange: string;     // "Last 30 Days" etc.
    selectedChildId: string | null;
}

interface ECDDataState {
    // Raw data
    children: Child[];
    riskScores: RiskScore[];
    alerts: Alert[];
    interventions: ChildIntervention[];
    analytics: Analytics | null;
    longitudinal: LongitudinalData | null;
    // Filters
    filters: ECDFilters;
    setMandal: (mandal: string) => void;
    setRole: (role: RoleType) => void;
    setDateRange: (range: string) => void;
    setSelectedChildId: (id: string | null) => void;
    // Computed
    filteredChildren: Child[];
    filteredRiskScores: RiskScore[];
    filteredAlerts: Alert[];
    filteredInterventions: ChildIntervention[];
    mandals: string[];
    districts: string[];
    // Status
    loading: boolean;
    error: string | null;
}

const ECDDataContext = createContext<ECDDataState | null>(null);

export function ECDDataProvider({ children: reactChildren }: { children: React.ReactNode }) {
    const [data, setData] = useState<{
        children: Child[];
        riskScores: RiskScore[];
        alerts: Alert[];
        interventions: ChildIntervention[];
        analytics: Analytics | null;
        longitudinal: LongitudinalData | null;
    }>({
        children: [],
        riskScores: [],
        alerts: [],
        interventions: [],
        analytics: null,
        longitudinal: null,
    });

    const [filters, setFilters] = useState<ECDFilters>({
        mandal: "All",
        role: "State Admin",
        dateRange: "Last 30 Days",
        selectedChildId: null,
    });

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        dataService
            .loadAll()
            .then((result) => {
                setData(result);
                setLoading(false);
            })
            .catch((err) => {
                console.error("Failed to load ECD data:", err);
                setError(err.message);
                setLoading(false);
            });
    }, []);

    const setMandal = useCallback((mandal: string) => {
        setFilters((f) => ({ ...f, mandal }));
    }, []);

    const setRole = useCallback((role: RoleType) => {
        setFilters((f) => ({ ...f, role }));
    }, []);

    const setDateRange = useCallback((dateRange: string) => {
        setFilters((f) => ({ ...f, dateRange }));
    }, []);

    const setSelectedChildId = useCallback((id: string | null) => {
        setFilters((f) => ({ ...f, selectedChildId: id }));
    }, []);

    const mandals = useMemo(() => {
        const set = new Set(data.children.map((c) => c.mandal));
        return ["All", ...Array.from(set).sort()];
    }, [data.children]);

    const districts = useMemo(() => {
        const set = new Set(data.children.map((c) => c.district));
        return Array.from(set).sort();
    }, [data.children]);

    const filteredChildren = useMemo(() => {
        if (filters.mandal === "All") return data.children;
        return data.children.filter((c) => c.mandal === filters.mandal);
    }, [data.children, filters.mandal]);

    const filteredChildIdSet = useMemo(
        () => new Set(filteredChildren.map((c) => c.child_id)),
        [filteredChildren]
    );

    const filteredRiskScores = useMemo(
        () => data.riskScores.filter((r) => filteredChildIdSet.has(r.child_id)),
        [data.riskScores, filteredChildIdSet]
    );

    const filteredAlerts = useMemo(
        () => data.alerts.filter((a) => a.child_id === null || filteredChildIdSet.has(a.child_id)),
        [data.alerts, filteredChildIdSet]
    );

    const filteredInterventions = useMemo(
        () => data.interventions.filter((i) => filteredChildIdSet.has(i.child_id)),
        [data.interventions, filteredChildIdSet]
    );

    const value: ECDDataState = {
        children: data.children,
        riskScores: data.riskScores,
        alerts: data.alerts,
        interventions: data.interventions,
        analytics: data.analytics,
        longitudinal: data.longitudinal,
        filters,
        setMandal,
        setRole,
        setDateRange,
        setSelectedChildId,
        filteredChildren,
        filteredRiskScores,
        filteredAlerts,
        filteredInterventions,
        mandals,
        districts,
        loading,
        error,
    };

    return (
        <ECDDataContext.Provider value={value}>
            {reactChildren}
        </ECDDataContext.Provider>
    );
}

export function useECDData(): ECDDataState {
    const ctx = useContext(ECDDataContext);
    if (!ctx) {
        throw new Error("useECDData must be used within ECDDataProvider");
    }
    return ctx;
}

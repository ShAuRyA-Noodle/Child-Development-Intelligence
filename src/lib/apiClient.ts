// ECD Intelligence Platform — API Client
// Handles all HTTP communication with the backend API
// Falls back to offline IndexedDB when network is unavailable

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001/api/v1";

interface RequestOptions extends RequestInit {
  timeout?: number;
}

class ApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public body: unknown,
  ) {
    super(`API Error ${status}: ${statusText}`);
    this.name = "ApiError";
  }
}

// ─── Token Management ────────────────────────────────────────────────────────

let accessToken: string | null = null;
let refreshToken: string | null = null;

export function setTokens(access: string, refresh: string): void {
  accessToken = access;
  refreshToken = refresh;
  localStorage.setItem("ecd_access_token", access);
  localStorage.setItem("ecd_refresh_token", refresh);
}

export function loadTokens(): void {
  accessToken = localStorage.getItem("ecd_access_token");
  refreshToken = localStorage.getItem("ecd_refresh_token");
}

export function clearTokens(): void {
  accessToken = null;
  refreshToken = null;
  localStorage.removeItem("ecd_access_token");
  localStorage.removeItem("ecd_refresh_token");
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function isAuthenticated(): boolean {
  return !!accessToken;
}

// ─── Network Status ──────────────────────────────────────────────────────────

let _isOnline = navigator.onLine;
const onlineListeners: Array<(online: boolean) => void> = [];

window.addEventListener("online", () => {
  _isOnline = true;
  onlineListeners.forEach((fn) => fn(true));
});
window.addEventListener("offline", () => {
  _isOnline = false;
  onlineListeners.forEach((fn) => fn(false));
});

export function isOnline(): boolean {
  return _isOnline;
}

export function onNetworkChange(fn: (online: boolean) => void): () => void {
  onlineListeners.push(fn);
  return () => {
    const idx = onlineListeners.indexOf(fn);
    if (idx >= 0) onlineListeners.splice(idx, 1);
  };
}

// ─── Core Fetch Wrapper ──────────────────────────────────────────────────────

async function refreshAccessToken(): Promise<boolean> {
  if (!refreshToken) return false;

  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (!res.ok) {
      clearTokens();
      return false;
    }

    const data = await res.json();
    setTokens(data.access_token, data.refresh_token);
    return true;
  } catch {
    return false;
  }
}

async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { timeout = 15000, ...fetchOptions } = options;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(fetchOptions.headers as Record<string, string>),
  };

  if (accessToken) {
    headers["Authorization"] = `Bearer ${accessToken}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    let res = await fetch(`${API_BASE}${path}`, {
      ...fetchOptions,
      headers,
      signal: controller.signal,
    });

    // Auto-refresh on 401
    if (res.status === 401 && refreshToken) {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        headers["Authorization"] = `Bearer ${accessToken}`;
        res = await fetch(`${API_BASE}${path}`, {
          ...fetchOptions,
          headers,
          signal: controller.signal,
        });
      }
    }

    clearTimeout(timeoutId);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new ApiError(res.status, res.statusText, body);
    }

    if (res.status === 204) return undefined as T;
    return res.json();
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof ApiError) throw err;
    if ((err as Error).name === "AbortError") {
      throw new Error(`Request timeout: ${path}`);
    }
    throw err;
  }
}

// ─── API Methods ─────────────────────────────────────────────────────────────

export const api = {
  // Auth
  login(phone: string, password: string) {
    return request<{ access_token: string; refresh_token: string; user: unknown }>(
      "/auth/login",
      { method: "POST", body: JSON.stringify({ phone, password }) },
    );
  },

  logout() {
    return request("/auth/logout", {
      method: "POST",
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  },

  // Children
  getChildren(params?: Record<string, string>) {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return request<{ data: unknown[]; total: number }>(`/children${qs}`);
  },

  getChild(id: string) {
    return request<unknown>(`/children/${id}`);
  },

  createChild(data: Record<string, unknown>) {
    return request<unknown>("/children", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  updateChild(id: string, data: Record<string, unknown>) {
    return request<unknown>(`/children/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  },

  // Assessments
  getAssessments(childId: string) {
    return request<unknown[]>(`/assessments?child_id=${childId}`);
  },

  createAssessment(data: Record<string, unknown>) {
    return request<unknown>("/assessments", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  // Risk Scores
  getRiskScores(params?: Record<string, string>) {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return request<unknown[]>(`/risk-scores${qs}`);
  },

  getChildRiskScore(childId: string) {
    return request<unknown>(`/risk-scores/${childId}`);
  },

  // Alerts
  getAlerts(params?: Record<string, string>) {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return request<unknown[]>(`/alerts${qs}`);
  },

  acknowledgeAlert(alertId: string) {
    return request<unknown>(`/alerts/${alertId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "acknowledged" }),
    });
  },

  getAlertSummary() {
    return request<{ p1: number; p2: number; p3: number }>("/alerts/summary");
  },

  // Interventions
  getInterventions(childId: string) {
    return request<unknown[]>(`/interventions?child_id=${childId}`);
  },

  createIntervention(data: Record<string, unknown>) {
    return request<unknown>("/interventions", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  logCompliance(interventionId: string, data: Record<string, unknown>) {
    return request<unknown>(`/interventions/${interventionId}/compliance`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  // Analytics
  getAnalytics(params?: Record<string, string>) {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return request<unknown>(`/analytics${qs}`);
  },

  getMandalAnalytics() {
    return request<unknown[]>("/analytics/mandals");
  },

  getDistrictAnalytics() {
    return request<unknown[]>("/analytics/districts");
  },

  getLongitudinalData() {
    return request<unknown>("/analytics/longitudinal");
  },

  // Sync
  pushMutations(mutations: unknown[]) {
    return request<{ applied: number; conflicts: unknown[] }>("/sync", {
      method: "POST",
      body: JSON.stringify({ mutations }),
    });
  },

  pullChanges(since: string | null) {
    return request<{ changes: unknown[]; server_time: string }>("/sync/pull", {
      method: "POST",
      body: JSON.stringify({ since }),
    });
  },

  getSyncStatus() {
    return request<{ last_sync: string; pending: number }>("/sync/status");
  },
};

// Initialize tokens from localStorage on module load
loadTokens();

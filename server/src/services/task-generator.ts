// ECD Intelligence Platform — Automated Task Generator
// Generates daily prioritized task lists for AWWs
// Manages alert escalation pipeline

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AWWTask {
  task_id: string;
  task_type: "assessment_due" | "followup_visit" | "alert_review" | "intervention_check" | "data_completion";
  child_id: string;
  priority: number; // 1 = highest
  title: string;
  description: string;
  due_date: string;
  estimated_minutes: number;
  status: "pending" | "completed" | "skipped";
}

export interface EscalationRule {
  alert_severity: "critical" | "high" | "moderate";
  initial_owner: "aww" | "supervisor" | "cdpo";
  escalation_chain: Array<{
    role: "aww" | "supervisor" | "cdpo" | "state_admin";
    timeout_hours: number;
  }>;
}

// ─── Escalation Rules ───────────────────────────────────────────────────────

const ESCALATION_RULES: EscalationRule[] = [
  {
    alert_severity: "critical",
    initial_owner: "aww",
    escalation_chain: [
      { role: "aww", timeout_hours: 4 },
      { role: "supervisor", timeout_hours: 12 },
      { role: "cdpo", timeout_hours: 24 },
      { role: "state_admin", timeout_hours: 48 },
    ],
  },
  {
    alert_severity: "high",
    initial_owner: "aww",
    escalation_chain: [
      { role: "aww", timeout_hours: 24 },
      { role: "supervisor", timeout_hours: 48 },
      { role: "cdpo", timeout_hours: 72 },
    ],
  },
  {
    alert_severity: "moderate",
    initial_owner: "aww",
    escalation_chain: [
      { role: "aww", timeout_hours: 72 },
      { role: "supervisor", timeout_hours: 168 }, // 7 days
    ],
  },
];

// ─── Task Generation Logic ──────────────────────────────────────────────────

interface ChildRecord {
  child_id: string;
  age_months: number;
  risk_category: string;
  last_assessment_date: string | null;
  last_followup_date: string | null;
  intervention_active: boolean;
  data_completeness: number; // 0-100
  pending_alerts: number;
}

export function generateDailyTasks(
  children: ChildRecord[],
  today: Date = new Date(),
): AWWTask[] {
  const tasks: AWWTask[] = [];
  const todayStr = today.toISOString().split("T")[0];
  let taskCounter = 0;

  for (const child of children) {
    // 1. Assessment Due — High-risk every 2 weeks, Medium every month, Low every quarter
    if (child.last_assessment_date) {
      const lastAssess = new Date(child.last_assessment_date);
      const daysSince = Math.floor((today.getTime() - lastAssess.getTime()) / (1000 * 60 * 60 * 24));

      const intervalDays =
        child.risk_category === "High" ? 14
          : child.risk_category === "Medium" ? 30
            : 90;

      if (daysSince >= intervalDays) {
        tasks.push({
          task_id: `task_${++taskCounter}_${todayStr}`,
          task_type: "assessment_due",
          child_id: child.child_id,
          priority: child.risk_category === "High" ? 1 : child.risk_category === "Medium" ? 3 : 5,
          title: `Assessment due: ${child.child_id}`,
          description: `Last assessed ${daysSince} days ago. ${child.risk_category} risk — reassessment needed.`,
          due_date: todayStr,
          estimated_minutes: 15,
          status: "pending",
        });
      }
    } else {
      // Never assessed — highest priority
      tasks.push({
        task_id: `task_${++taskCounter}_${todayStr}`,
        task_type: "assessment_due",
        child_id: child.child_id,
        priority: 1,
        title: `First assessment needed: ${child.child_id}`,
        description: `Child has never been assessed. Age: ${child.age_months} months.`,
        due_date: todayStr,
        estimated_minutes: 20,
        status: "pending",
      });
    }

    // 2. Follow-up Visit for high-risk children with active interventions
    if (child.intervention_active && child.risk_category !== "Low") {
      const lastFollowup = child.last_followup_date ? new Date(child.last_followup_date) : null;
      const daysSinceFollowup = lastFollowup
        ? Math.floor((today.getTime() - lastFollowup.getTime()) / (1000 * 60 * 60 * 24))
        : 999;

      if (daysSinceFollowup >= 7) {
        tasks.push({
          task_id: `task_${++taskCounter}_${todayStr}`,
          task_type: "followup_visit",
          child_id: child.child_id,
          priority: child.risk_category === "High" ? 2 : 4,
          title: `Follow-up visit: ${child.child_id}`,
          description: `Active intervention — last follow-up ${daysSinceFollowup === 999 ? "never" : daysSinceFollowup + " days ago"}.`,
          due_date: todayStr,
          estimated_minutes: 10,
          status: "pending",
        });
      }
    }

    // 3. Pending Alert Review
    if (child.pending_alerts > 0) {
      tasks.push({
        task_id: `task_${++taskCounter}_${todayStr}`,
        task_type: "alert_review",
        child_id: child.child_id,
        priority: child.risk_category === "High" ? 1 : 3,
        title: `Review ${child.pending_alerts} alert(s): ${child.child_id}`,
        description: `Unacknowledged alerts require review and action.`,
        due_date: todayStr,
        estimated_minutes: 5,
        status: "pending",
      });
    }

    // 4. Data Completion for incomplete records
    if (child.data_completeness < 80) {
      tasks.push({
        task_id: `task_${++taskCounter}_${todayStr}`,
        task_type: "data_completion",
        child_id: child.child_id,
        priority: 6,
        title: `Complete data: ${child.child_id}`,
        description: `Record is ${child.data_completeness}% complete. Missing fields need filling.`,
        due_date: todayStr,
        estimated_minutes: 5,
        status: "pending",
      });
    }
  }

  // Sort by priority (lower number = higher priority), cap at 20 tasks per day
  tasks.sort((a, b) => a.priority - b.priority);
  return tasks.slice(0, 20);
}

// ─── Alert Escalation Engine ────────────────────────────────────────────────

interface PendingAlert {
  alert_id: string;
  severity: "critical" | "high" | "moderate";
  current_owner_role: "aww" | "supervisor" | "cdpo" | "state_admin";
  created_at: string;
  acknowledged_at: string | null;
  escalation_level: number; // 0 = initial, 1 = first escalation, etc.
}

export interface EscalationAction {
  alert_id: string;
  action: "escalate" | "no_action";
  from_role: string;
  to_role: string;
  reason: string;
}

export function checkEscalations(
  alerts: PendingAlert[],
  now: Date = new Date(),
): EscalationAction[] {
  const actions: EscalationAction[] = [];

  for (const alert of alerts) {
    // Already acknowledged — no escalation needed
    if (alert.acknowledged_at) continue;

    const rule = ESCALATION_RULES.find((r) => r.alert_severity === alert.severity);
    if (!rule) continue;

    const createdAt = new Date(alert.created_at);
    const hoursSinceCreation = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60);

    // Find current escalation level timeout
    const currentLevel = alert.escalation_level;
    if (currentLevel >= rule.escalation_chain.length - 1) continue; // Already at max level

    const currentStep = rule.escalation_chain[currentLevel];
    const nextStep = rule.escalation_chain[currentLevel + 1];

    // Calculate cumulative timeout for this level
    let cumulativeTimeout = 0;
    for (let i = 0; i <= currentLevel; i++) {
      cumulativeTimeout += rule.escalation_chain[i].timeout_hours;
    }

    if (hoursSinceCreation >= cumulativeTimeout) {
      actions.push({
        alert_id: alert.alert_id,
        action: "escalate",
        from_role: currentStep.role,
        to_role: nextStep.role,
        reason: `Unacknowledged for ${Math.round(hoursSinceCreation)} hours (threshold: ${cumulativeTimeout}h)`,
      });
    }
  }

  return actions;
}

// ─── Reporting Automation ───────────────────────────────────────────────────

export interface ReportConfig {
  type: "monthly_district" | "quarterly_state" | "weekly_aww";
  period_start: string;
  period_end: string;
  scope: {
    district?: string;
    state?: string;
    aww_id?: string;
  };
}

export interface GeneratedReport {
  report_id: string;
  type: string;
  title: string;
  generated_at: string;
  sections: Array<{
    heading: string;
    data: Record<string, unknown>;
  }>;
}

export function generateReportStructure(config: ReportConfig): GeneratedReport {
  const reportId = `rpt_${config.type}_${Date.now()}`;

  const sectionMap: Record<string, Array<{ heading: string; data: Record<string, unknown> }>> = {
    monthly_district: [
      { heading: "Coverage Summary", data: { metric: "children_assessed_pct", target: 90 } },
      { heading: "Risk Distribution", data: { high: 0, medium: 0, low: 0, total: 0 } },
      { heading: "Intervention Coverage", data: { active_plans: 0, compliance_rate: 0 } },
      { heading: "Alert Summary", data: { generated: 0, acknowledged: 0, escalated: 0 } },
      { heading: "AWW Performance", data: { avg_assessments: 0, avg_followups: 0 } },
      { heading: "Top High-Risk Clusters", data: { clusters: [] } },
    ],
    quarterly_state: [
      { heading: "State KPI Dashboard", data: {} },
      { heading: "District Comparison", data: {} },
      { heading: "Risk Trend Analysis", data: {} },
      { heading: "Intervention Outcomes", data: {} },
      { heading: "Model Performance", data: { sensitivity: 0, specificity: 0, drift: false } },
      { heading: "Budget Utilization", data: {} },
    ],
    weekly_aww: [
      { heading: "My Children Summary", data: { total: 0, high_risk: 0 } },
      { heading: "Tasks Completed", data: { completed: 0, total: 0 } },
      { heading: "Assessments This Week", data: { done: 0, due: 0 } },
      { heading: "Follow-ups Pending", data: { count: 0 } },
    ],
  };

  return {
    report_id: reportId,
    type: config.type,
    title: `${config.type.replace(/_/g, " ")} Report: ${config.period_start} to ${config.period_end}`,
    generated_at: new Date().toISOString(),
    sections: sectionMap[config.type] || [],
  };
}

import { motion } from "framer-motion";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
  ResponsiveContainer
} from "recharts";
import { CheckCircle2, ChevronLeft, ChevronRight } from "lucide-react";
import { useECDData } from "@/contexts/ECDDataContext";
import { useMemo, useState } from "react";

export default function ChildProfile() {
  const { filteredChildren, filteredInterventions, filters, setSelectedChildId } = useECDData();
  const [childIndex, setChildIndex] = useState(0);

  // Select a child — prefer high-risk, or use selected
  const sortedChildren = useMemo(() => {
    const order: Record<string, number> = { High: 0, Medium: 1, Low: 2 };
    return [...filteredChildren].sort((a, b) => {
      const oa = order[a.computed_risk_category] ?? 3;
      const ob = order[b.computed_risk_category] ?? 3;
      if (oa !== ob) return oa - ob;
      return a.composite_dq - b.composite_dq;
    });
  }, [filteredChildren]);

  const child = sortedChildren[childIndex] || null;
  const intervention = useMemo(() => {
    if (!child) return null;
    return filteredInterventions.find(i => i.child_id === child.child_id) || null;
  }, [child, filteredInterventions]);

  const radarData = useMemo(() => {
    if (!child) return [];
    return [
      { domain: "Gross Motor", value: Math.round(child.gm_dq) },
      { domain: "Fine Motor", value: Math.round(child.fm_dq) },
      { domain: "Language", value: Math.round(child.lc_dq) },
      { domain: "Cognitive", value: Math.round(child.cog_dq) },
      { domain: "Socio-Emotional", value: Math.round(child.se_dq) },
    ];
  }, [child]);

  const riskColor = child?.computed_risk_category === "High" ? "text-risk-high" :
    child?.computed_risk_category === "Medium" ? "text-risk-medium" : "text-risk-low";

  if (!child) return null;

  const initials = child.child_id.replace("AP_ECD_", "").slice(-4);
  const ageYears = (child.age_months / 12).toFixed(1);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.5, duration: 0.5 }}
    >
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Child Profile · {child.child_id}
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setChildIndex(Math.max(0, childIndex - 1))}
            disabled={childIndex === 0}
            className="p-1 rounded hover:bg-secondary disabled:opacity-30 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-[10px] text-muted-foreground">
            {childIndex + 1} / {sortedChildren.length}
          </span>
          <button
            onClick={() => setChildIndex(Math.min(sortedChildren.length - 1, childIndex + 1))}
            disabled={childIndex >= sortedChildren.length - 1}
            className="p-1 rounded hover:bg-secondary disabled:opacity-30 transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Profile + Radar */}
        <div className="bg-card rounded-lg border border-border p-5 card-hover">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary">
              {child.gender === "M" ? "♂" : "♀"}
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">{child.child_id}</p>
              <p className="text-[11px] text-muted-foreground">
                Age: {ageYears} yrs · {child.gender} · {child.mandal} · DQ: {child.composite_dq.toFixed(0)}{" "}
                <span className={`font-medium ${riskColor}`}>({child.computed_risk_category} Risk)</span>
              </p>
            </div>
          </div>

          {/* Child details */}
          <div className="grid grid-cols-2 gap-2 mb-4 text-[11px] text-muted-foreground">
            <div>District: <span className="text-foreground font-medium">{child.district}</span></div>
            <div>AWC: <span className="text-foreground font-medium">{child.awc_code}</span></div>
            <div>Birth: <span className="text-foreground font-medium">{child.birth_status}</span></div>
            <div>Cycle: <span className="text-foreground font-medium">{child.assessment_cycle}</span></div>
            <div>Delays: <span className="text-foreground font-medium">{child.num_delays}</span></div>
            <div>Risk Score: <span className="text-foreground font-medium">{child.computed_risk_score}</span></div>
          </div>

          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="70%">
                <PolarGrid stroke="hsl(var(--border))" />
                <PolarAngleAxis
                  dataKey="domain"
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                />
                <Radar
                  dataKey="value"
                  stroke="hsl(var(--primary))"
                  fill="hsl(var(--primary))"
                  fillOpacity={0.15}
                  strokeWidth={1.5}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Intervention Plan */}
        <div className="bg-card rounded-lg border border-border p-5 card-hover">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-4">
            AI Recommended Intervention Plan
          </p>
          {intervention && intervention.plans.length > 0 ? (
            <div className="space-y-2.5 mb-6">
              {intervention.plans.slice(0, 5).map((plan, i) => (
                <div key={i} className="flex items-start gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-risk-low mt-0.5 shrink-0" />
                  <div>
                    <span className="text-sm text-foreground">{plan.activity}</span>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {plan.domain} · {plan.frequency}{plan.duration_minutes > 0 ? ` · ${plan.duration_minutes} min` : ""} · {plan.caregiver_format}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground mb-6">No interventions needed — child is within normal range.</p>
          )}

          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-3">
            Status
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <div className={`px-3 py-1.5 rounded-md text-xs font-medium ${child.improvement_status === "Improved" ? "bg-risk-low/10 text-risk-low" :
                child.improvement_status === "Same" ? "bg-secondary text-muted-foreground" :
                  "bg-risk-high/10 text-risk-high"
              }`}>
              {child.improvement_status}
            </div>
            <div className="text-[11px] text-muted-foreground">
              Delay reduced: <span className="font-medium text-foreground">{child.reduction_in_delay_months} months</span>
            </div>
            {child.referral_type !== "Unknown" && (
              <div className="text-[11px] text-muted-foreground">
                Referral: <span className="font-medium text-foreground">{child.referral_type}</span> ({child.referral_status})
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

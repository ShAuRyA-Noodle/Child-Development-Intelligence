import { motion } from "framer-motion";
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";
import { useECDData } from "@/contexts/ECDDataContext";
import { useMemo } from "react";

export default function LongitudinalImpact() {
  const { longitudinal } = useECDData();

  const data = useMemo(() => {
    if (!longitudinal) return [];
    return longitudinal.risk_trend;
  }, [longitudinal]);

  const cohort = longitudinal?.cohort_analytics;

  // Compute start and end values for display
  const startHigh = data[0]?.high_risk_pct ?? 0;
  const endHigh = data[data.length - 1]?.high_risk_pct ?? 0;
  const startMed = data[0]?.medium_risk_pct ?? 0;
  const endMed = data[data.length - 1]?.medium_risk_pct ?? 0;
  const highReduction = startHigh > 0 ? Math.round((1 - endHigh / startHigh) * 100) : 0;
  const medReduction = startMed > 0 ? Math.round((1 - endMed / startMed) * 100) : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.9, duration: 0.5 }}
    >
      <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-4">
        Longitudinal Impact · Projected Risk Reduction Over 6 Months
      </h2>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-card rounded-lg border border-border p-5 card-hover">
          <div className="flex gap-6 mb-4">
            <div>
              <p className="text-[10px] text-muted-foreground uppercase">High Risk</p>
              <p className="text-lg font-semibold text-foreground">
                {startHigh.toFixed(1)}% → {endHigh.toFixed(1)}%{" "}
                <span className="text-xs text-risk-low font-medium">↓ {highReduction}%</span>
              </p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase">Medium Risk</p>
              <p className="text-lg font-semibold text-foreground">
                {startMed.toFixed(1)}% → {endMed.toFixed(1)}%{" "}
                <span className="text-xs text-risk-low font-medium">↓ {medReduction}%</span>
              </p>
            </div>
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data}>
                <defs>
                  <linearGradient id="highGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(0, 55%, 58%)" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="hsl(0, 55%, 58%)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="medGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(38, 80%, 55%)" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="hsl(38, 80%, 55%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} domain={[0, 40]} />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 6, border: "1px solid hsl(var(--border))" }} />
                <Area type="monotone" dataKey="medium_risk_pct" name="Medium Risk %" stroke="hsl(38, 80%, 55%)" fill="url(#medGrad)" strokeWidth={2} />
                <Area type="monotone" dataKey="high_risk_pct" name="High Risk %" stroke="hsl(0, 55%, 58%)" fill="url(#highGrad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Cohort Summary */}
        <div className="bg-card rounded-lg border border-border p-5 card-hover">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-4">
            Cohort Analytics
          </p>
          {cohort && (
            <div className="space-y-4">
              <div>
                <p className="text-[10px] text-muted-foreground uppercase">Children Improved</p>
                <p className="text-2xl font-bold text-risk-low">{cohort.improved_pct}%</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase">Stable (Same)</p>
                <p className="text-2xl font-bold text-foreground">{cohort.same_pct}%</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase">Avg Delay Reduction</p>
                <p className="text-lg font-semibold text-foreground">{cohort.avg_delay_reduction_months} months</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase">Exited High Risk</p>
                <p className="text-lg font-semibold text-risk-low">{cohort.exit_high_risk_pct}%</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase">Domain Improvement</p>
                <p className="text-lg font-semibold text-primary">{cohort.domain_improvement_pct}%</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

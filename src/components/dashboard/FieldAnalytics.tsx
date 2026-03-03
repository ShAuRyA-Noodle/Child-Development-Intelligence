import { motion } from "framer-motion";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";
import { useECDData } from "@/contexts/ECDDataContext";
import { useMemo } from "react";

export default function FieldAnalytics() {
  const { analytics } = useECDData();

  const barData = useMemo(() => {
    if (!analytics) return [];
    const fp = analytics.field_performance;
    return [
      { metric: "Visit Compliance", value: Math.round(fp.visit_compliance) },
      { metric: "Intervention Coverage", value: Math.round(fp.intervention_coverage) },
      { metric: "Referral Completion", value: Math.round(fp.referral_completion) },
      { metric: "Risk Closure", value: Math.round(fp.risk_closure_rate) },
    ];
  }, [analytics]);

  const topCenters = useMemo(() => {
    if (!analytics) return [];
    return analytics.top_awc
      .slice(0, 5)
      .map((awc, i) => ({
        rank: i + 1,
        name: `AWC ${awc.awc_code} · ${awc.mandal}`,
        score: Math.round(awc.impact_score),
        children: awc.total_children,
      }));
  }, [analytics]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.8, duration: 0.5 }}
    >
      <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-4">
        Field Performance Analytics
      </h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card rounded-lg border border-border p-5 card-hover">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-4">
            AWW Performance Index
          </p>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData} layout="vertical">
                <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="metric" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={120} />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 6, border: "1px solid hsl(var(--border))" }} />
                <Bar dataKey="value" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} barSize={16} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-card rounded-lg border border-border p-5 card-hover">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-4">
            Top 5 Anganwadi Centers by Impact Score
          </p>
          <div className="space-y-2">
            {topCenters.map((c) => (
              <div key={c.rank} className="flex items-center gap-3">
                <span className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-semibold text-primary shrink-0">
                  {c.rank}
                </span>
                <span className="text-sm text-foreground flex-1">{c.name}</span>
                <div className="flex items-center gap-2">
                  <div className="w-24 h-1.5 bg-secondary rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${c.score}%` }}
                      transition={{ delay: 0.9 + c.rank * 0.1, duration: 0.6 }}
                      className="h-full bg-primary rounded-full"
                    />
                  </div>
                  <span className="text-xs font-semibold text-foreground w-6">{c.score}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

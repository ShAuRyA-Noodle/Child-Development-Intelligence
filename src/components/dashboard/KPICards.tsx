import { motion } from "framer-motion";
import { useCountUp } from "@/hooks/useCountUp";
import { LineChart, Line, ResponsiveContainer } from "recharts";
import { useECDData } from "@/contexts/ECDDataContext";
import { useMemo } from "react";

const sparkData = (base: number) =>
  Array.from({ length: 12 }, (_, i) => ({ v: base + Math.sin(i * 0.8) * base * 0.1 + Math.random() * base * 0.05 }));

function KPICard({ kpi, index }: { kpi: { label: string; value: number; change: string; accent: string; sparkBase: number }; index: number }) {
  const count = useCountUp(kpi.value, 1800);
  const data = useMemo(() => sparkData(kpi.sparkBase), [kpi.sparkBase]);
  const isPositive = kpi.change.startsWith("+");

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1, duration: 0.5 }}
      className="bg-card rounded-lg border border-border p-5 card-hover relative overflow-hidden"
    >
      <div className={`absolute top-0 left-0 w-full h-0.5 ${kpi.accent}`} />
      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-3">
        {kpi.label}
      </p>
      <div className="flex items-end justify-between">
        <div>
          <span className="text-3xl counter-text text-foreground">{count.toLocaleString()}</span>
          <span className={`ml-2 text-xs font-medium ${isPositive ? "text-risk-low" : "text-risk-high"}`}>
            {kpi.change}
          </span>
        </div>
        <div className="w-20 h-8">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <Line
                type="monotone"
                dataKey="v"
                stroke="hsl(var(--primary))"
                strokeWidth={1.5}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </motion.div>
  );
}

export default function KPICards() {
  const { filteredChildren } = useECDData();

  const kpis = useMemo(() => {
    const total = filteredChildren.length;
    const highRisk = filteredChildren.filter(c => c.computed_risk_category === "High").length;
    const mediumRisk = filteredChildren.filter(c => c.computed_risk_category === "Medium").length;
    const interventionActive = filteredChildren.filter(c => c.intervention_plan_generated === "Yes").length;

    return [
      { label: "Total Children Tracked", value: total, change: `${total}`, accent: "kpi-accent-primary", sparkBase: total },
      { label: "High Risk", value: highRisk, change: `${((highRisk / Math.max(total, 1)) * 100).toFixed(1)}%`, accent: "kpi-accent-high", sparkBase: highRisk || 1 },
      { label: "Medium Risk", value: mediumRisk, change: `${((mediumRisk / Math.max(total, 1)) * 100).toFixed(1)}%`, accent: "kpi-accent-medium", sparkBase: mediumRisk || 1 },
      { label: "Intervention Active", value: interventionActive, change: `${((interventionActive / Math.max(total, 1)) * 100).toFixed(1)}%`, accent: "kpi-accent-low", sparkBase: interventionActive || 1 },
    ];
  }, [filteredChildren]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {kpis.map((kpi, i) => (
        <KPICard key={kpi.label} kpi={kpi} index={i} />
      ))}
    </div>
  );
}

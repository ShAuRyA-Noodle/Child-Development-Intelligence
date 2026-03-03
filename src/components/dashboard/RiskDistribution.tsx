import { motion } from "framer-motion";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { useState, useMemo } from "react";
import { useECDData } from "@/contexts/ECDDataContext";

function HeatCell({ cell }: { cell: { id: number; mandal: string; highRisk: number; total: number; referralPending: number } }) {
  const [hovered, setHovered] = useState(false);
  const intensity = Math.min(cell.highRisk / Math.max(cell.total, 1), 1);
  const bg = `hsl(0, 55%, ${90 - intensity * 40}%)`;

  return (
    <div
      className="relative rounded-sm aspect-square cursor-pointer transition-transform hover:scale-110"
      style={{ backgroundColor: bg }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {hovered && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-foreground text-card text-[10px] px-2.5 py-1.5 rounded shadow-lg whitespace-nowrap z-10">
          {cell.mandal} | High Risk: {cell.highRisk}/{cell.total} | Referral Pending: {cell.referralPending}
        </div>
      )}
    </div>
  );
}

export default function RiskDistribution() {
  const { filteredChildren, analytics } = useECDData();

  const donutData = useMemo(() => {
    const total = filteredChildren.length;
    if (total === 0) return [];
    const high = filteredChildren.filter(c => c.computed_risk_category === "High").length;
    const medium = filteredChildren.filter(c => c.computed_risk_category === "Medium").length;
    const low = filteredChildren.filter(c => c.computed_risk_category === "Low").length;
    return [
      { name: "Low Risk", value: Math.round(low / total * 100), color: "hsl(152, 40%, 42%)" },
      { name: "Medium Risk", value: Math.round(medium / total * 100), color: "hsl(38, 80%, 55%)" },
      { name: "High Risk", value: Math.round(high / total * 100), color: "hsl(0, 55%, 58%)" },
    ];
  }, [filteredChildren]);

  const heatmapData = useMemo(() => {
    if (!analytics) return [];
    return analytics.mandals.map((m, i) => ({
      id: i,
      mandal: m.mandal,
      highRisk: m.high_risk,
      total: m.total,
      referralPending: m.referral_pending,
    }));
  }, [analytics]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3, duration: 0.5 }}
    >
      <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-4">
        Risk Distribution
      </h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Donut Chart */}
        <div className="bg-card rounded-lg border border-border p-5 card-hover">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-4">Risk Categories</p>
          <div className="flex items-center gap-6">
            <div className="w-40 h-40">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={donutData}
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={65}
                    dataKey="value"
                    strokeWidth={0}
                  >
                    {donutData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number) => `${value}%`}
                    contentStyle={{
                      fontSize: 11,
                      borderRadius: 6,
                      border: "1px solid hsl(var(--border))",
                      boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-3">
              {donutData.map((d) => (
                <div key={d.name} className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                  <span className="text-xs text-muted-foreground">{d.name}</span>
                  <span className="text-xs font-semibold text-foreground ml-auto">{d.value}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Heat Map */}
        <div className="bg-card rounded-lg border border-border p-5 card-hover">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-4">
            Mandal-Level Risk Heatmap
          </p>
          <div className="grid grid-cols-4 gap-1.5">
            {heatmapData.map((cell) => (
              <HeatCell key={cell.id} cell={cell} />
            ))}
          </div>
          <div className="flex items-center justify-between mt-3">
            <span className="text-[10px] text-muted-foreground">Low</span>
            <div className="flex gap-0.5">
              {[90, 78, 66, 54, 50].map((l) => (
                <div key={l} className="w-4 h-2 rounded-sm" style={{ backgroundColor: `hsl(0, 55%, ${l}%)` }} />
              ))}
            </div>
            <span className="text-[10px] text-muted-foreground">High</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

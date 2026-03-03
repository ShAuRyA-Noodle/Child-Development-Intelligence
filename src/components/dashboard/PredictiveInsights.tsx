import { motion } from "framer-motion";
import { Brain, Mic, Activity, ArrowRight, AlertTriangle, Heart } from "lucide-react";
import { useECDData } from "@/contexts/ECDDataContext";
import { useMemo } from "react";

const domainIcons: Record<string, React.ElementType> = {
  "Speech": Mic,
  "Motor": Activity,
  "Cognitive": Brain,
  "Behavioral": AlertTriangle,
  "Socio-emotional": Heart,
  "Multi-domain": AlertTriangle,
  "Nutrition": Activity,
  "Cluster": AlertTriangle,
};

const severityColors: Record<string, string> = {
  critical: "bg-destructive/10 text-destructive border-destructive/20",
  high: "bg-orange-500/10 text-orange-600 border-orange-500/20",
  moderate: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20",
};

export default function PredictiveInsights() {
  const { filteredAlerts } = useECDData();

  // Show top alerts sorted by severity then confidence
  const topAlerts = useMemo(() => {
    const severityOrder: Record<string, number> = { critical: 0, high: 1, moderate: 2 };
    return [...filteredAlerts]
      .sort((a, b) => {
        const sA = severityOrder[a.severity] ?? 3;
        const sB = severityOrder[b.severity] ?? 3;
        if (sA !== sB) return sA - sB;
        return b.confidence - a.confidence;
      })
      .slice(0, 6);
  }, [filteredAlerts]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.4, duration: 0.5 }}
    >
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Early Warning Intelligence
        </h2>
        <span className="text-[10px] text-muted-foreground">
          {filteredAlerts.length} total alerts
        </span>
      </div>
      <div className="space-y-3">
        {topAlerts.map((alert, i) => {
          const Icon = domainIcons[alert.domain] || AlertTriangle;
          const colorCls = severityColors[alert.severity] || severityColors.moderate;

          return (
            <motion.div
              key={alert.alert_id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.5 + i * 0.1, duration: 0.4 }}
              className={`bg-card rounded-lg border p-4 card-hover flex items-center gap-4 ${colorCls}`}
            >
              <div className="w-9 h-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                <Icon className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{alert.message}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {alert.domain} · {alert.indicator} · Confidence: {alert.confidence}%
                  {alert.child_id && <span> · {alert.child_id}</span>}
                </p>
              </div>
              <div className="shrink-0 flex flex-col items-end gap-1">
                <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full ${alert.severity === "critical" ? "bg-destructive/20 text-destructive" :
                    alert.severity === "high" ? "bg-orange-500/20 text-orange-600" :
                      "bg-yellow-500/20 text-yellow-600"
                  }`}>
                  {alert.severity}
                </span>
                <button className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                  Action
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}

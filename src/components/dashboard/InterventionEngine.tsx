import { motion } from "framer-motion";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, Legend } from "recharts";
import { Zap, BookOpen, Hand, Heart, Brain, Activity } from "lucide-react";
import { useECDData } from "@/contexts/ECDDataContext";
import { useMemo } from "react";

const domainIcons: Record<string, React.ElementType> = {
  "Speech & Language": BookOpen,
  "Gross Motor": Activity,
  "Fine Motor": Hand,
  "Cognitive": Brain,
  "Socio-Emotional": Heart,
  "Behavioral": Zap,
  "Nutrition": Activity,
};

export default function InterventionEngine() {
  const { filteredInterventions, longitudinal } = useECDData();

  // Aggregate top intervention types across all children
  const topActivities = useMemo(() => {
    const domainCounts: Record<string, { count: number; activity: string; freq: string; domain: string }> = {};
    for (const ci of filteredInterventions) {
      for (const plan of ci.plans) {
        if (!domainCounts[plan.domain]) {
          domainCounts[plan.domain] = { count: 0, activity: plan.activity, freq: plan.frequency, domain: plan.domain };
        }
        domainCounts[plan.domain].count++;
      }
    }
    return Object.values(domainCounts)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [filteredInterventions]);

  const trajectoryData = useMemo(() => {
    if (!longitudinal) return [];
    return longitudinal.intervention_comparison;
  }, [longitudinal]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.6, duration: 0.5 }}
    >
      <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-4">
        Intervention Engine
      </h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card rounded-lg border border-border p-5 card-hover">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-4">
            Top Intervention Areas ({filteredInterventions.length} children)
          </p>
          <div className="space-y-3">
            {topActivities.map((a, i) => {
              const Icon = domainIcons[a.domain] || Zap;
              return (
                <div key={i} className="flex items-center gap-3 p-3 rounded-md bg-secondary/50">
                  <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                    <Icon className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-foreground">{a.domain}</p>
                    <p className="text-[11px] text-muted-foreground">{a.count} children · {a.freq}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-card rounded-lg border border-border p-5 card-hover">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-4">
            Projected Outcome: With vs Without Intervention
          </p>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trajectoryData}>
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} domain={[60, 120]} />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 6, border: "1px solid hsl(var(--border))" }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="with_intervention" name="With Intervention" stroke="hsl(var(--success))" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="without_intervention" name="Without Intervention" stroke="hsl(var(--destructive))" strokeWidth={2} dot={false} strokeDasharray="4 4" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

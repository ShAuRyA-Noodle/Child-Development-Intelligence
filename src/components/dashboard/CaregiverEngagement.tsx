import { motion } from "framer-motion";
import { useCountUp } from "@/hooks/useCountUp";
import { useECDData } from "@/contexts/ECDDataContext";
import { useMemo } from "react";

function CircularProgress({ value, label, color }: { value: number; label: string; color: string }) {
  const count = useCountUp(value, 1500);
  const circumference = 2 * Math.PI * 36;
  const offset = circumference - (count / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-20 h-20">
        <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80">
          <circle cx="40" cy="40" r="36" fill="none" stroke="hsl(var(--border))" strokeWidth="4" />
          <circle
            cx="40" cy="40" r="36" fill="none" stroke={color} strokeWidth="4"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className="transition-all duration-1000"
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-foreground">
          {count}%
        </span>
      </div>
      <span className="text-[10px] text-muted-foreground text-center leading-tight">{label}</span>
    </div>
  );
}

export default function CaregiverEngagement() {
  const { analytics, filteredChildren } = useECDData();

  const metrics = useMemo(() => {
    if (!analytics) {
      return { followup: 0, homeActivity: 0, playMaterials: 0 };
    }

    const total = filteredChildren.length || 1;
    const followup = Math.round(
      filteredChildren.filter(c => c.followup_conducted === "Yes").length / total * 100
    );
    const homeActivity = Math.round(
      filteredChildren.reduce((sum, c) => sum + c.home_activities_assigned, 0) / (total * 10) * 100
    );
    const playMaterials = Math.round(
      filteredChildren.filter(c => c.play_materials === "Yes").length / total * 100
    );

    return { followup, homeActivity, playMaterials };
  }, [analytics, filteredChildren]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.7, duration: 0.5 }}
    >
      <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-4">
        Caregiver Engagement
      </h2>
      <div className="bg-card rounded-lg border border-border p-5 card-hover">
        <div className="flex items-center justify-between mb-5">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Engagement Metrics
          </p>
          <div className="flex gap-1 bg-secondary rounded-md p-0.5">
            {["English", "Telugu", "Hindi"].map((lang, i) => (
              <button
                key={lang}
                className={`text-[10px] px-2.5 py-1 rounded transition-colors ${i === 0 ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
              >
                {lang}
              </button>
            ))}
          </div>
        </div>
        <div className="flex justify-around">
          <CircularProgress value={metrics.followup} label="Follow-up Conducted" color="hsl(var(--primary))" />
          <CircularProgress value={metrics.homeActivity} label="Home Activity Completion" color="hsl(var(--success))" />
          <CircularProgress value={metrics.playMaterials} label="Play Materials Available" color="hsl(var(--warning))" />
        </div>
      </div>
    </motion.div>
  );
}

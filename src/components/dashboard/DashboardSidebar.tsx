import { useState } from "react";
import { motion } from "framer-motion";
import {
  LayoutDashboard, AlertTriangle, Users, Calendar,
  Heart, BarChart3, Shield, ChevronLeft, ChevronRight
} from "lucide-react";

const navItems = [
  { icon: LayoutDashboard, label: "Dashboard", active: true },
  { icon: AlertTriangle, label: "Risk Stratification" },
  { icon: Users, label: "Child Profiles" },
  { icon: Calendar, label: "Intervention Planner" },
  { icon: Heart, label: "Caregiver Insights" },
  { icon: BarChart3, label: "Field Analytics" },
  { icon: Shield, label: "System Governance" },
];

export default function DashboardSidebar() {
  const [collapsed, setCollapsed] = useState(true);

  return (
    <motion.aside
      animate={{ width: collapsed ? 64 : 220 }}
      transition={{ duration: 0.3, ease: "easeInOut" }}
      className="fixed left-0 top-0 h-screen bg-sidebar z-50 flex flex-col border-r border-sidebar-border"
    >
      <div className="h-14 flex items-center justify-center border-b border-sidebar-border px-3">
        {!collapsed && (
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-xs font-semibold tracking-widest uppercase text-sidebar-primary"
          >
            ECD · AI
          </motion.span>
        )}
        {collapsed && (
          <span className="text-sm font-bold text-sidebar-primary">E</span>
        )}
      </div>

      <nav className="flex-1 py-4 space-y-1 px-2">
        {navItems.map((item) => (
          <button
            key={item.label}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors text-sm ${
              item.active
                ? "bg-sidebar-accent text-sidebar-primary-foreground"
                : "text-sidebar-foreground hover:bg-sidebar-accent/50"
            }`}
          >
            <item.icon className="w-4 h-4 shrink-0" />
            {!collapsed && (
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="truncate text-xs font-medium"
              >
                {item.label}
              </motion.span>
            )}
          </button>
        ))}
      </nav>

      <button
        onClick={() => setCollapsed(!collapsed)}
        className="p-3 border-t border-sidebar-border text-sidebar-muted hover:text-sidebar-foreground transition-colors"
      >
        {collapsed ? <ChevronRight className="w-4 h-4 mx-auto" /> : <ChevronLeft className="w-4 h-4 mx-auto" />}
      </button>
    </motion.aside>
  );
}

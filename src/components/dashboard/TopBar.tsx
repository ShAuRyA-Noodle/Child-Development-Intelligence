import { Bell } from "lucide-react";
import { useECDData } from "@/contexts/ECDDataContext";
import type { RoleType } from "@/types/ecd";

export default function TopBar() {
  const { mandals, filters, setMandal, setRole, setDateRange, filteredChildren } = useECDData();

  return (
    <header className="h-14 border-b border-border bg-card flex items-center justify-between px-6 sticky top-0 z-40">
      <div className="flex items-center gap-2">
        <h1 className="text-sm font-semibold text-foreground tracking-tight">
          AI-Powered Early Childhood Intelligence
        </h1>
        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary">
          LIVE
        </span>
        <span className="text-[10px] text-muted-foreground ml-2">
          {filteredChildren.length.toLocaleString()} children
        </span>
      </div>

      <div className="flex items-center gap-3">
        <select
          value={filters.role}
          onChange={(e) => setRole(e.target.value as RoleType)}
          className="text-xs bg-secondary border-none rounded-md px-3 py-1.5 text-secondary-foreground focus:ring-1 focus:ring-ring outline-none"
        >
          <option>AWW Worker</option>
          <option>Supervisor</option>
          <option>CDPO</option>
          <option>State Admin</option>
        </select>

        <select
          value={filters.mandal}
          onChange={(e) => setMandal(e.target.value)}
          className="text-xs bg-secondary border-none rounded-md px-3 py-1.5 text-secondary-foreground focus:ring-1 focus:ring-ring outline-none"
        >
          {mandals.map((m) => (
            <option key={m} value={m}>
              {m === "All" ? "All Mandals" : `Mandal: ${m}`}
            </option>
          ))}
        </select>

        <select
          value={filters.dateRange}
          onChange={(e) => setDateRange(e.target.value)}
          className="text-xs bg-secondary border-none rounded-md px-3 py-1.5 text-secondary-foreground focus:ring-1 focus:ring-ring outline-none"
        >
          <option>Last 30 Days</option>
          <option>Last 7 Days</option>
          <option>Last 90 Days</option>
        </select>

        <button className="relative p-2 rounded-md hover:bg-secondary transition-colors">
          <Bell className="w-4 h-4 text-muted-foreground" />
          <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-destructive" />
        </button>
      </div>
    </header>
  );
}

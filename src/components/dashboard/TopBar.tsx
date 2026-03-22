import { Bell, Globe } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useECDData } from "@/contexts/ECDDataContext";
import type { RoleType } from "@/types/ecd";
import SyncStatusBar from "./SyncStatusBar";
import { SUPPORTED_LANGUAGES } from "@/i18n";

export default function TopBar() {
  const { mandals, filters, setMandal, setRole, setDateRange, filteredChildren } = useECDData();
  const { i18n } = useTranslation();

  const changeLanguage = (lang: string) => {
    i18n.changeLanguage(lang);
    localStorage.setItem("ecd_language", lang);
  };

  return (
    <div className="sticky top-0 z-40">
      <header className="h-14 border-b border-border bg-card flex items-center justify-between px-6">
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
          {/* Language Switcher */}
          <div className="flex items-center gap-1">
            <Globe className="w-3.5 h-3.5 text-muted-foreground" />
            <select
              value={i18n.language}
              onChange={(e) => changeLanguage(e.target.value)}
              className="text-xs bg-secondary border-none rounded-md px-2 py-1.5 text-secondary-foreground focus:ring-1 focus:ring-ring outline-none"
            >
              {SUPPORTED_LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.nativeLabel}
                </option>
              ))}
            </select>
          </div>

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

      {/* Sync Status Bar */}
      <div className="px-6 py-1 bg-card/80 backdrop-blur border-b border-border/50">
        <SyncStatusBar />
      </div>
    </div>
  );
}

// ECD Intelligence Platform — Sync Status Bar
// Shows connectivity status, pending sync count, and last sync time
// Designed for AWW visibility: clear offline/online indicators

import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Wifi, WifiOff, RefreshCw, CheckCircle2, AlertCircle, Clock,
} from "lucide-react";
import { isOnline, onNetworkChange } from "@/lib/apiClient";
import {
  getSyncState, onSyncStateChange, performSync,
  type SyncStatus,
} from "@/lib/syncEngine";
import { getPendingMutationCount } from "@/lib/offlineDb";

export default function SyncStatusBar() {
  const [online, setOnline] = useState(isOnline());
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const unsubNetwork = onNetworkChange(setOnline);
    const unsubSync = onSyncStateChange((state) => {
      setSyncStatus(state.status);
      setLastSync(state.lastSync);
      setPendingCount(state.pendingCount);
    });

    // Initial load
    const state = getSyncState();
    setSyncStatus(state.status);
    setLastSync(state.lastSync);
    getPendingMutationCount().then(setPendingCount);

    return () => {
      unsubNetwork();
      unsubSync();
    };
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await performSync();
    } catch {
      // Error state handled by sync engine
    } finally {
      setSyncing(false);
    }
  };

  const formatLastSync = (ts: string | null): string => {
    if (!ts) return "Never";
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  const statusConfig: Record<SyncStatus, { icon: React.ReactNode; label: string; color: string }> = {
    idle: { icon: <CheckCircle2 className="w-3.5 h-3.5" />, label: "Synced", color: "text-green-500" },
    syncing: { icon: <RefreshCw className="w-3.5 h-3.5 animate-spin" />, label: "Syncing...", color: "text-blue-500" },
    error: { icon: <AlertCircle className="w-3.5 h-3.5" />, label: "Sync Error", color: "text-red-500" },
    offline: { icon: <WifiOff className="w-3.5 h-3.5" />, label: "Offline", color: "text-amber-500" },
  };

  const config = statusConfig[syncStatus];

  return (
    <div className="flex items-center gap-3 px-3 py-1.5 bg-muted/50 rounded-lg text-xs">
      {/* Online/Offline indicator */}
      <div className="flex items-center gap-1.5">
        {online ? (
          <Wifi className="w-3.5 h-3.5 text-green-500" />
        ) : (
          <WifiOff className="w-3.5 h-3.5 text-amber-500" />
        )}
        <span className={online ? "text-green-600" : "text-amber-600"}>
          {online ? "Online" : "Offline"}
        </span>
      </div>

      <span className="text-muted-foreground">|</span>

      {/* Sync status */}
      <div className={`flex items-center gap-1.5 ${config.color}`}>
        {config.icon}
        <span>{config.label}</span>
      </div>

      {/* Pending count */}
      {pendingCount > 0 && (
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
          {pendingCount} pending
        </Badge>
      )}

      {/* Last sync time */}
      <div className="flex items-center gap-1 text-muted-foreground ml-auto">
        <Clock className="w-3 h-3" />
        <span>{formatLastSync(lastSync)}</span>
      </div>

      {/* Manual sync button */}
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-2 text-xs"
        onClick={handleSync}
        disabled={syncing || !online}
      >
        <RefreshCw className={`w-3 h-3 mr-1 ${syncing ? "animate-spin" : ""}`} />
        Sync
      </Button>
    </div>
  );
}

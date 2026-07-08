"use client";

import { useState } from "react";
import { AlertTriangle, CloudUpload, Loader2, WifiOff } from "lucide-react";
import { useOfflineStatus } from "@/hooks/useOfflineStatus";
import PendingSyncPanel from "@/components/layout/PendingSyncPanel";
import { cn } from "@/lib/utils";

export default function OfflineBanner() {
  const {
    isOnline,
    queueLength,
    failedLength,
    isProcessing,
    processQueue,
    retryFailed,
    clearFailed,
  } = useOfflineStatus();
  const [panelOpen, setPanelOpen] = useState(false);

  if (isOnline && queueLength === 0 && failedLength === 0) return null;

  return (
    <div dir="rtl" className="flex flex-col">
      {/* Offline / pending-sync state */}
      {(!isOnline || queueLength > 0) && (
        <div
          className={cn(
            "flex items-center justify-between gap-3 px-4 py-2 text-sm font-medium",
            !isOnline
              ? "bg-destructive text-destructive-foreground"
              : "bg-warning-soft text-warning-soft-foreground"
          )}
        >
          <div className="flex items-center gap-2">
            {isOnline ? (
              <CloudUpload className="h-4 w-4 shrink-0" />
            ) : (
              <WifiOff className="h-4 w-4 shrink-0" />
            )}
            <span>
              {!isOnline && queueLength === 0 &&
                "אין חיבור לאינטרנט — פעולות שמירה יישמרו ויישלחו כשיחזור החיבור"}
              {!isOnline && queueLength > 0 &&
                `אין חיבור — ${queueLength} פעולות נשמרו ויישלחו כשיחזור החיבור`}
              {isOnline && queueLength > 0 && `${queueLength} פעולות ממתינות לשליחה`}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPanelOpen(true)}
              className="rounded bg-black/10 px-2 py-1 text-xs hover:bg-black/20"
            >
              פרטים
            </button>
            {isOnline && queueLength > 0 && (
              <button
                type="button"
                onClick={() => void processQueue()}
                disabled={isProcessing}
                className="flex items-center gap-1.5 rounded bg-warning px-2 py-1 text-xs text-warning-foreground hover:opacity-90 disabled:opacity-60"
              >
                {isProcessing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {isProcessing ? "שולח..." : "שלח עכשיו"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Permanently-failed actions — surfaced for review instead of looping silently */}
      {failedLength > 0 && (
        <div className="flex items-center justify-between gap-3 bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{`${failedLength} פעולות לא נשמרו בשרת — יש לנסות שוב`}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPanelOpen(true)}
              className="rounded bg-destructive-foreground/15 px-2 py-1 text-xs hover:bg-destructive-foreground/25"
            >
              פרטים
            </button>
            <button
              type="button"
              onClick={retryFailed}
              className="rounded bg-destructive-foreground/15 px-2 py-1 text-xs hover:bg-destructive-foreground/25"
            >
              נסה שוב
            </button>
            <button
              type="button"
              onClick={clearFailed}
              className="rounded px-2 py-1 text-xs hover:bg-destructive-foreground/15"
            >
              התעלם
            </button>
          </div>
        </div>
      )}

      <PendingSyncPanel open={panelOpen} onOpenChange={setPanelOpen} />
    </div>
  );
}

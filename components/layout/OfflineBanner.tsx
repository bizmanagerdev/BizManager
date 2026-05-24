"use client";

import { CloudUpload, Loader2, WifiOff } from "lucide-react";
import { useOfflineStatus } from "@/hooks/useOfflineStatus";
import { cn } from "@/lib/utils";

export default function OfflineBanner() {
  const { isOnline, queueLength, isProcessing, processQueue } = useOfflineStatus();

  if (isOnline && queueLength === 0) return null;

  return (
    <div
      dir="rtl"
      className={cn(
        "flex items-center justify-between gap-3 px-4 py-2 text-sm font-medium",
        !isOnline
          ? "bg-destructive-soft text-destructive"
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
          {!isOnline && queueLength === 0 && "אין חיבור לאינטרנט — פעולות שמירה יישמרו ויישלחו כשיחזור החיבור"}
          {!isOnline && queueLength > 0 && `אין חיבור — ${queueLength} פעולות ממתינות לשליחה`}
          {isOnline && queueLength > 0 && `${queueLength} פעולות ממתינות לשליחה`}
        </span>
      </div>
      {isOnline && queueLength > 0 && (
        <button
          type="button"
          onClick={() => void processQueue()}
          disabled={isProcessing}
          className="flex items-center gap-1.5 rounded px-2 py-1 text-xs hover:bg-warning/20 disabled:opacity-60"
        >
          {isProcessing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {isProcessing ? "שולח..." : "שלח עכשיו"}
        </button>
      )}
    </div>
  );
}

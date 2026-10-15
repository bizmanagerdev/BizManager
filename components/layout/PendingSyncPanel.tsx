"use client";

/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useState } from "react";
import { CloseIcon, DocumentIcon, RefreshIcon, SyncIcon, WarningIcon } from "@/components/ui/icons";
import { DeleteButton } from "@/components/ui/icon-button";
import {
  CONNECTION_EVENTS,
  getFailed,
  getQueue,
  processQueue,
  removeFailed,
  retryFailedEntry,
  type QueueEntry,
} from "@/lib/offline-queue";
import {
  getUploadFailed,
  getUploadQueue,
  processUploadQueue,
  removeFailedUpload,
  retryFailedUpload,
  type UploadEntry,
} from "@/lib/offline-upload";
import { ViewDialog } from "@/components/ui/view-dialog";
import { useLocalDatabase } from "@/lib/powersync/store";
import { formatTimeOnly } from "@/lib/date";
import { readDeviceSavesWaiting, type DeviceSaveWaiting } from "@/lib/powersync/device-saves-waiting";

const DEVICE_CHANGE_WORD: Record<DeviceSaveWaiting["change"], string> = {
  new: "חדש",
  changed: "שינוי",
  removed: "מחיקה",
};

/** How often the phone-copy part is read again while the list is open. */
const DEVICE_REFRESH_MS = 2500;

// Israel's clock, not the device's.
function formatTime(ts?: number) {
  if (!ts) return "";
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "" : formatTimeOnly(d.toISOString(), "");
}

/** First image part of an upload entry → an object URL for a thumbnail (or null). */
function thumbFor(entry: UploadEntry): string | null {
  const imagePart = entry.parts.find((p) => p.fileType.startsWith("image/"));
  if (!imagePart) return null;
  try {
    return URL.createObjectURL(imagePart.blob);
  } catch {
    return null;
  }
}

type Snapshot = {
  pendingWrites: QueueEntry[];
  pendingUploads: UploadEntry[];
  failedWrites: QueueEntry[];
  failedUploads: UploadEntry[];
  thumbs: Record<string, string>;
};

const EMPTY: Snapshot = { pendingWrites: [], pendingUploads: [], failedWrites: [], failedUploads: [], thumbs: {} };

/**
 * "מה ממתין לשליחה" — a concrete view of the offline queues so a field user can
 * SEE that the photo/action they just took is safely saved (and retry or discard
 * anything that permanently failed), instead of only a count in the banner.
 * Every kind: the offline queue, files, and the saves made on the phone's own
 * copy (tasks and the rest — lib/powersync/device-saves-waiting.ts), which
 * PowerSync sends by itself once the connection is back.
 */
export default function PendingSyncPanel({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [snap, setSnap] = useState<Snapshot>(EMPTY);
  const localDb = useLocalDatabase();
  const [deviceSaves, setDeviceSaves] = useState<DeviceSaveWaiting[]>([]);

  // The phone-copy part: read when the list opens, then again every few
  // seconds — its queue raises no event of its own.
  useEffect(() => {
    if (!open || !localDb) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDeviceSaves([]);
      return;
    }
    let cancelled = false;
    const read = () =>
      void readDeviceSavesWaiting(localDb).then((lines) => {
        if (!cancelled) setDeviceSaves(lines);
      });
    read();
    const timer = window.setInterval(read, DEVICE_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [open, localDb]);

  const refresh = useCallback(async () => {
    const [pendingUploads, failedUploads] = await Promise.all([getUploadQueue(), getUploadFailed()]);
    const thumbs: Record<string, string> = {};
    for (const entry of [...pendingUploads, ...failedUploads]) {
      const url = thumbFor(entry);
      if (url) thumbs[entry.id] = url;
    }
    // Revoke the previous batch's URLs before replacing them, so opening/refreshing
    // the panel repeatedly doesn't leak object URLs.
    setSnap((prev) => {
      for (const url of Object.values(prev.thumbs)) URL.revokeObjectURL(url);
      return { pendingWrites: getQueue(), pendingUploads, failedWrites: getFailed(), failedUploads, thumbs };
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    // refresh() awaits IndexedDB before any setState, so this is async I/O, not
    // the synchronous cascading render the lint rule guards against.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const onChanged = () => void refresh();
    window.addEventListener(CONNECTION_EVENTS.changed, onChanged);
    return () => window.removeEventListener(CONNECTION_EVENTS.changed, onChanged);
  }, [open, refresh]);

  // Release any remaining thumbnail URLs when the panel unmounts.
  useEffect(() => {
    return () => setSnap((prev) => {
      for (const url of Object.values(prev.thumbs)) URL.revokeObjectURL(url);
      return EMPTY;
    });
  }, []);

  const pendingCount = snap.pendingWrites.length + snap.pendingUploads.length + deviceSaves.length;
  const failedCount = snap.failedWrites.length + snap.failedUploads.length;

  return (
    <ViewDialog
      open={open}
      onOpenChange={onOpenChange}
      title="פעולות שממתינות לשליחה"
      description="הפעולות נשמרו במכשיר ויישלחו אוטומטית כשהחיבור יחזור."
      size="formMd"
    >

        {pendingCount === 0 && failedCount === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">אין פעולות ממתינות — הכול מסונכרן.</p>
        ) : null}

        {pendingCount > 0 ? (
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-muted-foreground">ממתין ({pendingCount})</h4>
            {snap.pendingUploads.map((entry) => (
              <Row
                key={entry.id}
                thumb={snap.thumbs[entry.id]}
                label={entry.label}
                meta={`נשמר ${formatTime(entry.queuedAt)}`}
              />
            ))}
            {snap.pendingWrites.map((entry) => (
              <Row key={entry.id} label={entry.label} meta={`נשמר ${formatTime(entry.queuedAt)}`} />
            ))}
            {deviceSaves.map((line) => (
              <Row key={line.key} label={line.label} meta={`${DEVICE_CHANGE_WORD[line.change]} · נשמר בטלפון, יישלח לבד`} />
            ))}
          </div>
        ) : null}

        {failedCount > 0 ? (
          <div className="space-y-2">
            <h4 className="flex items-center gap-1.5 text-sm font-semibold text-destructive">
              <WarningIcon className="h-4 w-4" /> נכשל ({failedCount})
            </h4>
            {snap.failedUploads.map((entry) => (
              <Row
                key={entry.id}
                thumb={snap.thumbs[entry.id]}
                label={entry.label}
                meta={entry.lastError || "לא נשלח"}
                failed
                onRetry={() => {
                  void retryFailedUpload(entry.id).then(() => processUploadQueue());
                }}
                onDiscard={() => void removeFailedUpload(entry.id)}
              />
            ))}
            {snap.failedWrites.map((entry) => (
              <Row
                key={entry.id}
                label={entry.label}
                meta={entry.lastError || "לא נשלח"}
                failed
                onRetry={() => {
                  retryFailedEntry(entry.id);
                  void processQueue();
                }}
                onDiscard={() => removeFailed(entry.id)}
              />
            ))}
          </div>
        ) : null}
    </ViewDialog>
  );
}

function Row({
  thumb,
  label,
  meta,
  failed = false,
  onRetry,
  onDiscard,
}: {
  thumb?: string;
  label: string;
  meta: string;
  failed?: boolean;
  onRetry?: () => void;
  onDiscard?: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-card/60 p-2.5">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted/40">
        {thumb ? (
          <img src={thumb} alt={label} className="h-full w-full object-cover" />
        ) : failed ? (
          <DocumentIcon className="h-5 w-5 text-muted-foreground" />
        ) : (
          <SyncIcon className="h-5 w-5 text-muted-foreground" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{label || "פעולה"}</div>
        <div className={`text-xs ${failed ? "text-destructive" : "text-muted-foreground"}`}>{meta}</div>
      </div>
      {failed ? (
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onRetry}
            aria-label="נסה שוב"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary hover:bg-primary/15"
          >
            <RefreshIcon className="h-4 w-4" />
          </button>
          <DeleteButton label="הסרה מהתור" onClick={onDiscard} />
        </div>
      ) : (
        <CloseIcon className="h-3.5 w-3.5 shrink-0 text-transparent" />
      )}
    </div>
  );
}

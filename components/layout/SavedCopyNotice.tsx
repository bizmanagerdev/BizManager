"use client";

import { useEffect, useState } from "react";
import { OfflineIcon } from "@/components/ui/icons";

// The page on screen is a copy saved on this device, shown because the server
// didn't answer in time (the service worker marks it: <html data-bizh-saved>,
// public/sw.js) — a connection that hangs rather than fails, as a worker's in
// the field did (2026-10-07). Says so, with when it was saved, and reloads by
// itself the moment the server answers again. If a reload already landed on a
// saved copy a moment ago (the server answers, but too slowly for the page),
// it stops reloading by itself and offers a button instead.

/** How often the server is asked whether it's back. */
const CHECK_EVERY_MS = 5000;
/** A second saved copy this soon after reloading for a fresh one: stop reloading by itself. */
const RELOAD_BACKOFF_MS = 60_000;

function lastReloadKey(): string {
  return `bizh-saved-reload:${location.pathname}`;
}

export default function SavedCopyNotice() {
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [autoReload, setAutoReload] = useState(true);

  useEffect(() => {
    const raw = document.documentElement.dataset.bizhSaved;
    if (raw === undefined) return;
    let last = 0;
    try {
      last = Number(sessionStorage.getItem(lastReloadKey()) ?? "0");
    } catch {
      // No session storage: reload by itself as usual.
    }
    const reloadByItself = Date.now() - last > RELOAD_BACKOFF_MS;
    // Read from the page itself once it's on screen — the marker comes from the service worker, not React.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSavedAt(Number(raw) || 0);
    setAutoReload(reloadByItself);
    if (!reloadByItself) return;

    let stopped = false;
    const check = async () => {
      try {
        await fetch("/api/ping", { cache: "no-store" });
        if (stopped) return;
        stopped = true;
        try {
          sessionStorage.setItem(lastReloadKey(), String(Date.now()));
        } catch {
          // Fine without it.
        }
        location.reload();
      } catch {
        // Still no answer.
      }
    };
    const timer = setInterval(() => void check(), CHECK_EVERY_MS);
    void check();
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);

  if (savedAt === null) return null;
  const time = savedAt
    ? new Intl.DateTimeFormat("he-IL", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "numeric" }).format(savedAt)
    : null;

  return (
    <div
      dir="rtl"
      role="status"
      className="flex items-center justify-between gap-3 bg-warning-soft px-4 py-2 text-sm font-medium text-warning-soft-foreground"
    >
      <div className="flex items-center gap-2">
        <OfflineIcon className="h-4 w-4 shrink-0" />
        <span>
          אין חיבור לשרת — מוצגת הגרסה השמורה במכשיר{time ? ` (${time})` : ""}.
          {autoReload ? " תתעדכן לבד כשהחיבור יחזור." : null}
        </span>
      </div>
      {autoReload ? null : (
        <button
          type="button"
          onClick={() => location.reload()}
          className="shrink-0 rounded bg-black/10 px-2 py-1 text-xs hover:bg-black/20"
        >
          נסה שוב
        </button>
      )}
    </div>
  );
}

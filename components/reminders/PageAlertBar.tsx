"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CloseIcon, WarningIcon } from "@/components/ui/icons";
import { useAlertsVersion } from "@/lib/ui/alerts-refresh";
import type { Locale } from "@/lib/i18n/types";

type PageAlert = { id: string; title: string; href: string; severity: "danger" | "warning" | "info" };

// A dismissible contextual banner for the top of a page — the viewer's open
// alerts for the given rule keys (e.g. <PageAlertBar keys={["low_stock"]} /> on
// /sales). Renders nothing when there's nothing to show. Dismissal is per view.
//
// Floats OVER the page instead of sitting in normal flow: the outer wrapper is
// zero-height (`h-0`), so whatever the page renders next starts exactly where
// it always would; the actual banners are `absolute`-positioned inside it and
// visually overlap that content instead of shoving it down. Dismissing one
// just removes it — nothing underneath ever moved, so nothing needs to
// "settle back" (user report: alerts were pushing the page's own content down).
const TONE: Record<string, string> = {
  danger: "border-destructive/30 bg-destructive-soft text-destructive shadow-md",
  warning: "border-warning/30 bg-warning-soft text-warning-strong shadow-md",
  info: "border-info/30 bg-info-soft text-info-soft-foreground shadow-md",
};

// Dismissals persist for the session (sessionStorage) so a closed banner doesn't
// pop back as you move between pages — but returns in a fresh session if still true.
const DISMISS_KEY = "pab_dismissed";
function readDismissed(): Set<string> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(DISMISS_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

export default function PageAlertBar({ keys, locale = "he" }: { keys: string[]; locale?: Locale }) {
  const [alerts, setAlerts] = useState<PageAlert[] | null>(null);
  // Lazy init from sessionStorage (readDismissed guards the SSR case → empty set).
  const [dismissed, setDismissed] = useState<Set<string>>(() => readDismissed());
  const keyParam = keys.join(",");

  function dismiss(id: string) {
    setDismissed((prev) => {
      const next = new Set(prev).add(id);
      try {
        sessionStorage.setItem(DISMISS_KEY, JSON.stringify([...next]));
      } catch {
        // storage full / private mode — dismissal still holds for this view
      }
      return next;
    });
  }

  // Refetch on: key change, a resync (alertsVersion bump), and window focus.
  const alertsVersion = useAlertsVersion();
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const res = await fetch(`/api/reminders/page-alerts?keys=${encodeURIComponent(keyParam)}`, { cache: "no-store" });
        const d = (res.ok ? await res.json().catch(() => null) : null) as { alerts?: PageAlert[] } | null;
        if (!cancelled) setAlerts(d?.alerts ?? []);
      } catch {
        if (!cancelled) setAlerts([]);
      }
    };
    void run();
    const onFocus = () => void run();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, [keyParam, alertsVersion]);

  const shown = (alerts ?? []).filter((a) => !dismissed.has(a.id));
  if (shown.length === 0) return null;

  return (
    <div className="relative z-20 h-0 overflow-visible">
      <div className="absolute inset-x-0 top-0 space-y-2 pb-2">
        {shown.map((a) => (
          <div
            key={a.id}
            className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 text-[13px] sm:text-sm ${TONE[a.severity] ?? TONE.warning}`}
          >
            <WarningIcon className="h-4 w-4 shrink-0" />
            <Link href={a.href} title={a.title} className="min-w-0 flex-1 font-medium hover:underline">
              {a.title}
            </Link>
            <button
              type="button"
              onClick={() => dismiss(a.id)}
              className="shrink-0 rounded-md p-0.5 opacity-60 transition-opacity hover:opacity-100"
              aria-label={locale === "ar" ? "إغلاق التنبيه" : "סגור התראה"}
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

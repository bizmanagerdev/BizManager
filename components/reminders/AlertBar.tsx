"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { MetaRow } from "@/components/ui/meta-row";
import {
  WarningIcon,
  AlertCircleIcon,
  NotificationIcon,
  CloseIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CheckIcon,
  ClockIcon,
} from "@/components/ui/icons";
import { useAlertBarAlerts, refreshAlertBarAlerts } from "@/lib/ui/alert-bar-store";
import { notifyAlertsChanged } from "@/lib/ui/alerts-refresh";
import type { AlertLevel, SystemAlert } from "@/lib/reminders/alert-bar";
import type { Locale } from "@/lib/i18n/types";

// One shared alert strip, mounted once by AppShell — see components/layout/AppShell.tsx.
// Replaces every per-page banner (PageAlertBar and its 9 call sites). Renders nothing
// when there are no alerts; never truncates; @container-driven mobile/desktop split.

const LEVEL_ORDER: AlertLevel[] = ["danger", "warning", "info"];

const STRINGS: Record<Locale, Record<string, string>> = {
  he: {
    close: "סגור",
    showAll: "הצג הכל",
    done: "סמן כבוצע",
    dismiss: "דחה",
    changeDate: "שנה תאריך",
    presetHour: "שעה",
    presetTomorrow: "מחר",
    presetWeek: "שבוע",
    cancel: "ביטול",
    overduePrefix: "באיחור",
    today: "היום",
    tomorrow: "מחר",
    inDays: "בעוד",
    days: "ימים",
    day: "יום",
  },
  ar: {
    close: "إغلاق",
    showAll: "عرض الكل",
    done: "وضع علامة تم",
    dismiss: "تجاهل",
    changeDate: "تغيير التاريخ",
    presetHour: "ساعة",
    presetTomorrow: "غدا",
    presetWeek: "أسبوع",
    cancel: "إلغاء",
    overduePrefix: "متأخر",
    today: "اليوم",
    tomorrow: "غدا",
    inDays: "خلال",
    days: "أيام",
    day: "يوم",
  },
};

const LEVEL_LABEL: Record<Locale, Record<AlertLevel, string>> = {
  he: { danger: "באיחור", warning: "לטיפול", info: "תזכורת" },
  ar: { danger: "متأخر", warning: "يحتاج متابعة", info: "تذكير" },
};

const LEVEL_BADGE_VARIANT: Record<AlertLevel, "destructive" | "warning" | "info"> = {
  danger: "destructive",
  warning: "warning",
  info: "info",
};

const LEVEL_TONE: Record<AlertLevel, string> = {
  danger: "border-destructive/30 bg-destructive-soft text-destructive",
  warning: "border-warning/30 bg-warning-soft text-warning-strong",
  info: "border-info/30 bg-info-soft text-info-soft-foreground",
};

const LEVEL_DOT: Record<AlertLevel, string> = {
  danger: "bg-destructive",
  warning: "bg-warning",
  info: "bg-info",
};

function LevelIcon({ level, className }: { level: AlertLevel; className?: string }) {
  if (level === "danger") return <WarningIcon className={className} />;
  if (level === "warning") return <AlertCircleIcon className={className} />;
  return <NotificationIcon className={className} />;
}

function highestLevel(alerts: SystemAlert[]): AlertLevel | null {
  for (const level of LEVEL_ORDER) {
    if (alerts.some((a) => a.level === level)) return level;
  }
  return null;
}

/** Bare relative-time label ("41 ימים", "מחר", "בעוד 12 יום") for the expanded list. */
function formatRelative(iso: string, locale: Locale): string {
  const s = STRINGS[locale];
  const target = new Date(iso);
  target.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (days === 0) return s.today;
  if (days === 1) return s.tomorrow;
  if (days > 1) return `${s.inDays} ${days} ${s.day}`;
  const n = Math.abs(days);
  return `${n} ${s.days}`;
}

const DISMISS_KEY = "alert_bar_dismissed_ids";

function readDismissedIds(): Set<string> | null {
  try {
    const raw = sessionStorage.getItem(DISMISS_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : null;
  } catch {
    return null;
  }
}

export function AlertBar({ locale = "he" }: { locale?: Locale }) {
  const { alerts: allAlerts } = useAlertBarAlerts();
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);
  const [dismissedIds, setDismissedIds] = useState<Set<string> | null>(() => readDismissedIds());
  const [acting, setActing] = useState<string | null>(null);
  const [snoozeOpenId, setSnoozeOpenId] = useState<string | null>(null);
  const s = STRINGS[locale];

  // Strict module match, and ONLY this page's own module — no "+N elsewhere"
  // indicator at all (user, 2026-09-11: "who cares what's going on another page").
  // A page with nothing of its own shows nothing, never another page's alerts.
  const primary = useMemo(() => {
    const currentModule = pathname?.split("/").filter(Boolean)[0] ?? null;
    return (allAlerts ?? []).filter((a) => a.module === currentModule);
  }, [allAlerts, pathname]);

  const allIds = useMemo(() => primary.map((a) => a.id), [primary]);

  // Dismissed for the session unless a genuinely new alert id has shown up since.
  const isDismissed = dismissedIds !== null && allIds.every((id) => dismissedIds.has(id));

  function dismiss() {
    const snapshot = new Set(allIds);
    setDismissedIds(snapshot);
    try {
      sessionStorage.setItem(DISMISS_KEY, JSON.stringify([...snapshot]));
    } catch {
      // storage full / private mode — dismissal still holds for this render
    }
  }

  async function act(alert: SystemAlert, action: "done" | "dismiss" | "snooze", snoozeUntil?: string) {
    if (alert.reminderIds.length === 0) return;
    setActing(alert.id);
    setSnoozeOpenId(null);
    try {
      await Promise.all(
        alert.reminderIds.map((id) =>
          fetch("/api/reminders/action", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, action, snooze_until: snoozeUntil }),
          })
        )
      );
    } finally {
      setActing(null);
      refreshAlertBarAlerts();
      notifyAlertsChanged();
    }
  }

  if (primary.length === 0 || isDismissed) return null;

  const level = highestLevel(primary) ?? "info";
  const restLevels = LEVEL_ORDER.filter((l) => l !== level && primary.some((a) => a.level === l));

  if (primary.length === 1) {
    const alert = primary[0]!;
    return (
      <div className={cn("@container border-b", LEVEL_TONE[alert.level])}>
        <div className="mx-auto flex w-full max-w-[1600px] items-center gap-2 px-3 py-1.5 text-sm @[45em]:px-6">
          <LevelIcon level={alert.level} className="h-4 w-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <MetaRow
              items={[
                <Link key="t" href={alert.href} className="font-medium hover:underline">
                  {alert.title}
                </Link>,
                alert.dueAt
                  ? new Date(alert.dueAt) < new Date()
                    ? `${s.overduePrefix} ${formatRelative(alert.dueAt, locale)}`
                    : formatRelative(alert.dueAt, locale)
                  : null,
              ]}
            />
          </div>
          {alert.reminderIds.length > 0 ? (
            <button
              type="button"
              disabled={acting === alert.id}
              onClick={() => act(alert, "done")}
              title={s.done}
              aria-label={s.done}
              className="shrink-0 rounded-lg p-1.5 text-current hover:bg-background/60 disabled:opacity-50"
            >
              <CheckIcon className="h-4 w-4" />
            </button>
          ) : (
            <Link href={alert.href} className="shrink-0 rounded-lg px-2 py-1 text-sm font-medium hover:underline">
              {s.showAll}
            </Link>
          )}
          <button type="button" onClick={dismiss} aria-label={s.close} className="shrink-0 rounded-md p-1 opacity-60 hover:opacity-100">
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  const listId = "alert-bar-list";

  return (
    <div className={cn("@container border-b", LEVEL_TONE[level])}>
      <div className="mx-auto flex w-full max-w-[1600px] items-center gap-2 px-3 py-1.5 @[45em]:px-6">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls={listId}
          className="flex min-w-0 flex-1 items-center gap-2 text-start"
        >
          <LevelIcon className="h-4 w-4 shrink-0" level={level} />
          <span id={`${listId}-label`} className="shrink-0 text-xs font-semibold">
            {primary.filter((a) => a.level === level).length} {LEVEL_LABEL[locale][level]}
          </span>
          <span className="flex min-w-0 flex-wrap items-center gap-1">
            {restLevels.map((l) => (
              <Badge key={l} variant={LEVEL_BADGE_VARIANT[l]} className="px-1.5 py-0 text-[0.625rem]">
                {primary.filter((a) => a.level === l).length}
              </Badge>
            ))}
          </span>
          {/* Spacer, then the chevron — both inside the same trigger button so the
              whole row (everything except ✕) is clickable, per spec. */}
          <span className="flex-1" />
          {expanded ? <ChevronUpIcon className="h-3.5 w-3.5 shrink-0" /> : <ChevronDownIcon className="h-3.5 w-3.5 shrink-0" />}
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label={s.close}
          className="shrink-0 rounded-md p-1 opacity-60 hover:opacity-100"
        >
          <CloseIcon className="h-4 w-4" />
        </button>
      </div>

      <div
        id={listId}
        role="region"
        aria-labelledby={`${listId}-label`}
        className={cn(
          "grid transition-[grid-template-rows] duration-150 motion-reduce:transition-none",
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        )}
      >
        <div className="overflow-hidden">
          <div
            className={cn(
              "flex flex-col divide-y divide-border/60 border-t border-border/60 bg-background text-foreground transition-opacity duration-150 motion-reduce:transition-none",
              expanded ? "opacity-100" : "opacity-0"
            )}
          >
            {[...primary]
              .sort((a, b) => LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level))
              .slice(0, 5)
              .map((alert) => (
                <div key={alert.id} className="relative flex min-w-0 items-center gap-2 px-3 py-1.5 text-xs @[45em]:px-6">
                  <Link href={alert.href} className="absolute inset-0" aria-hidden />
                  <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", LEVEL_DOT[alert.level])} />
                  <div className="pointer-events-none min-w-0 flex-1">
                    <MetaRow items={[alert.title, alert.dueAt ? formatRelative(alert.dueAt, locale) : null]} />
                  </div>
                  {alert.reminderIds.length > 0 ? (
                    <span className="pointer-events-auto relative z-10 flex shrink-0 items-center gap-0.5">
                      {snoozeOpenId === alert.id ? (
                        <>
                          <button
                            type="button"
                            className="rounded-md bg-secondary px-1.5 py-0.5 text-[0.6875rem] font-medium text-secondary-foreground"
                            onClick={() => act(alert, "snooze", new Date(Date.now() + 3_600_000).toISOString())}
                          >
                            {s.presetHour}
                          </button>
                          <button
                            type="button"
                            className="rounded-md bg-secondary px-1.5 py-0.5 text-[0.6875rem] font-medium text-secondary-foreground"
                            onClick={() => act(alert, "snooze", new Date(Date.now() + 86_400_000).toISOString())}
                          >
                            {s.presetTomorrow}
                          </button>
                          <button
                            type="button"
                            className="rounded-md bg-secondary px-1.5 py-0.5 text-[0.6875rem] font-medium text-secondary-foreground"
                            onClick={() => act(alert, "snooze", new Date(Date.now() + 604_800_000).toISOString())}
                          >
                            {s.presetWeek}
                          </button>
                          <button type="button" className="rounded-md px-1.5 py-0.5 text-[0.6875rem]" onClick={() => setSnoozeOpenId(null)}>
                            {s.cancel}
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            disabled={acting === alert.id}
                            title={s.done}
                            aria-label={s.done}
                            onClick={() => act(alert, "done")}
                            className="rounded-md p-1 text-muted-foreground hover:bg-success/10 hover:text-success disabled:opacity-50"
                          >
                            <CheckIcon className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={acting === alert.id}
                            title={s.dismiss}
                            aria-label={s.dismiss}
                            onClick={() => act(alert, "dismiss")}
                            className="rounded-md p-1 text-muted-foreground hover:bg-muted disabled:opacity-50"
                          >
                            <CloseIcon className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={acting === alert.id}
                            title={s.changeDate}
                            aria-label={s.changeDate}
                            onClick={() => setSnoozeOpenId(alert.id)}
                            className="rounded-md p-1 text-muted-foreground hover:bg-muted disabled:opacity-50"
                          >
                            <ClockIcon className="h-3.5 w-3.5" />
                          </button>
                        </>
                      )}
                    </span>
                  ) : null}
                </div>
              ))}
            {primary.length > 5 ? (
              <Link href="/inbox" className="px-3 py-1.5 text-center text-xs font-medium hover:underline @[45em]:px-6">
                {s.showAll}
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export default AlertBar;

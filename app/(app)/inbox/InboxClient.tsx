"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CashIcon, CheckIcon, CheckboxCheckedIcon, ChevronLeftIcon, ClockIcon, CoinsIcon, NotificationIcon, ProductIcon, ProjectIcon, ReceiptIcon, SettingsIcon, SuccessIcon, VehicleIcon, WalletIcon } from "@/components/ui/icons";
import { toast } from "sonner";
import { toHebrewError } from "@/lib/error-messages";
import { refreshAlerts } from "@/lib/ui/alerts-store";
import { Button } from "@/components/ui/button";
import PushSubscribeButton from "@/components/notifications/PushSubscribeButton";
import ReminderFormDialog, { type ReminderFormValue } from "@/components/reminders/ReminderFormDialog";
import { cn } from "@/lib/utils";
import { NOTIF_BUCKETS } from "@/lib/notifications/categories";
import { inboxBucket, inboxOrigin, type InboxView, type WorklistItem, type WorklistSeverity } from "@/lib/reminders/worklist";
import { EditButton } from "@/components/ui/icon-button";
import type { Locale } from "@/lib/i18n/types";
import { t } from "@/lib/i18n/t";
import { commonDict } from "@/lib/i18n/dictionaries/common";
import { inboxDict } from "@/lib/i18n/dictionaries/inbox";

// Severity paints the icon tile; the rule picks the glyph. So colour answers
// "how bad is it" at a glance and the icon answers "what kind of thing is it".
const TILE: Record<WorklistSeverity, string> = {
  danger: "bg-destructive/10 text-destructive",
  warning: "bg-warning/15 text-warning",
  info: "bg-primary/10 text-primary",
};

const RULE_ICON: Record<string, typeof NotificationIcon> = {
  collection_overdue: ClockIcon,
  payment_due_today: CoinsIcon,
  promise_broken: ClockIcon,
  check_deposit_due: CashIcon,
  recurring_expense_confirm: ReceiptIcon,
  task_overdue: CheckboxCheckedIcon,
  task_due_soon: CheckboxCheckedIcon,
  nightly_review: CheckboxCheckedIcon,
  project_deadline: ProjectIcon,
  project_starting: ProjectIcon,
  stale_quote: ProjectIcon,
  project_closed_unbilled: ProjectIcon,
  wage_overdue: WalletIcon,
  low_stock: ProductIcon,
  unprocessed_items: ProductIcon,
  vehicle_expiry: VehicleIcon,
};

function iconFor(item: WorklistItem) {
  if (item.source === "manual") return NotificationIcon;
  const rule = (item.dedupeKey ?? "").split(":")[0];
  return RULE_ICON[rule] ?? NotificationIcon;
}

// The verb that matches the destination, so the link says what it does.
function actionLabel(item: WorklistItem, locale: Locale): string {
  if (item.source === "manual") return t(inboxDict, locale, "actionOpen");
  const rule = (item.dedupeKey ?? "").split(":")[0];
  if (rule.startsWith("task")) return t(inboxDict, locale, "actionOpenTask");
  if (rule.startsWith("project") || rule === "stale_quote") return t(inboxDict, locale, "actionOpenProject");
  if (rule === "check_deposit_due") return t(inboxDict, locale, "actionOpenChecks");
  if (rule === "low_stock") return t(inboxDict, locale, "actionOrderStock");
  if (rule === "unprocessed_items") return t(inboxDict, locale, "actionOpenCreditPage");
  if (rule === "vehicle_expiry") return t(inboxDict, locale, "actionOpenVehicle");
  if (rule === "wage_overdue") return t(inboxDict, locale, "actionOpenPayroll");
  if (rule === "recurring_expense_confirm") return t(inboxDict, locale, "actionOpenExpense");
  return t(inboxDict, locale, "actionOpen");
}

function timeAgo(iso: string, locale: Locale): string {
  if (!iso) return "";
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return "";
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return t(inboxDict, locale, "timeNow");
  if (mins < 60) return t(inboxDict, locale, "timeMinutesAgo").replace("{n}", String(mins));
  const hours = Math.round(mins / 60);
  if (hours < 24) return t(inboxDict, locale, "timeHoursAgo").replace("{n}", String(hours));
  const days = Math.round(hours / 24);
  if (days === 1) return t(inboxDict, locale, "timeYesterday");
  if (days < 30) return t(inboxDict, locale, "timeDaysAgo").replace("{n}", String(days));
  return new Intl.DateTimeFormat(locale === "ar" ? "ar" : "he-IL", { day: "2-digit", month: "2-digit" }).format(ts);
}

// Day buckets, so the list reads as a timeline rather than one long wall.
function dayGroup(iso: string): "today" | "yesterday" | "earlier" {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "earlier";
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (d.getTime() >= start.getTime()) return "today";
  const y = new Date(start);
  y.setDate(y.getDate() - 1);
  if (d.getTime() >= y.getTime()) return "yesterday";
  return "earlier";
}
function groupLabel(key: string, locale: Locale): string {
  if (key === "today") return t(commonDict, locale, "today");
  if (key === "yesterday") return t(inboxDict, locale, "timeYesterday");
  return t(inboxDict, locale, "groupEarlier");
}

function preset(kind: "hour" | "tomorrow" | "week"): string {
  const d = new Date();
  if (kind === "hour") d.setHours(d.getHours() + 1);
  else if (kind === "tomorrow") {
    d.setDate(d.getDate() + 1);
    d.setHours(8, 0, 0, 0);
  } else d.setDate(d.getDate() + 7);
  return d.toISOString();
}

export default function InboxClient({
  inbox,
  assignedByMe = [],
  canSync,
  hasPush,
  locale,
}: {
  inbox: InboxView;
  assignedByMe?: WorklistItem[];
  canSync: boolean;
  hasPush: boolean;
  locale: Locale;
}) {
  const router = useRouter();
  const [bucket, setBucket] = useState<string>("all");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [snoozeOpen, setSnoozeOpen] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [marking, setMarking] = useState(false);
  const [editing, setEditing] = useState<ReminderFormValue | null>(null);
  const [showSnoozed, setShowSnoozed] = useState(false);

  const visible = useMemo(
    () => inbox.items.filter((i) => !hidden.has(i.id) && (bucket === "all" || inboxBucket(i) === bucket)),
    [inbox.items, hidden, bucket]
  );
  const visibleSummaries = bucket === "all" ? inbox.summaries : [];
  const visibleSnoozed = useMemo(() => inbox.snoozed.filter((i) => !hidden.has(i.id)), [inbox.snoozed, hidden]);
  const visibleByMe = useMemo(() => assignedByMe.filter((i) => !hidden.has(i.id)), [assignedByMe, hidden]);

  // Only offer chips for buckets that actually have something in them.
  const chips = useMemo(
    () => [
      { key: "all", label: t(inboxDict, locale, "allChip"), count: inbox.counts.all },
      ...NOTIF_BUCKETS.filter((b) => (inbox.byBucket[b.key] ?? 0) > 0).map((b) => ({
        key: b.key,
        label: b.label,
        count: inbox.byBucket[b.key] ?? 0,
      })),
    ],
    [inbox.byBucket, inbox.counts.all, locale]
  );

  const grouped = useMemo(() => {
    const out: Array<{ key: string; items: WorklistItem[] }> = [];
    for (const key of ["today", "yesterday", "earlier"]) {
      const items = visible.filter((i) => dayGroup(i.remindAt) === key);
      if (items.length) out.push({ key, items });
    }
    return out;
  }, [visible]);

  async function act(id: string, action: "done" | "dismiss" | "snooze" | "reopen", snoozeUntil?: string) {
    setBusy(id);
    setSnoozeOpen(null);
    setHidden((prev) => new Set(prev).add(id));
    try {
      const res = await fetch("/api/reminders/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action, snooze_until: snoozeUntil }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error);
      toast.success(
        action === "done"
          ? t(inboxDict, locale, "toastDone")
          : action === "snooze"
            ? t(inboxDict, locale, "snoozedLabel")
            : action === "reopen"
              ? t(inboxDict, locale, "toastReopened")
              : t(inboxDict, locale, "toastDismissed")
      );
      refreshAlerts();
      router.refresh();
    } catch (err) {
      setHidden((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      toast.error(toHebrewError(err, t(inboxDict, locale, "toastActionFailed")));
    } finally {
      setBusy(null);
    }
  }

  async function markAllSeen() {
    setMarking(true);
    try {
      const res = await fetch("/api/reminders/seen", { method: "POST" });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error);
      router.refresh();
    } catch (err) {
      toast.error(toHebrewError(err, t(inboxDict, locale, "toastActionFailed")));
    } finally {
      setMarking(false);
    }
  }

  async function runSync() {
    setSyncing(true);
    try {
      const res = await fetch("/api/reminders/sync-now", { method: "POST" });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error);
      toast.success(t(inboxDict, locale, "toastSynced"));
      refreshAlerts();
      router.refresh();
    } catch (err) {
      toast.error(toHebrewError(err, t(inboxDict, locale, "toastSyncFailed")));
    } finally {
      setSyncing(false);
    }
  }

  function Card({ item, muted = false }: { item: WorklistItem; muted?: boolean }) {
    const Icon = iconFor(item);
    const mine = inboxOrigin(item) === "mine";
    return (
      <div
        className={cn(
          "flex items-start gap-3 rounded-2xl border border-border/60 p-3 transition-colors",
          // Unseen items carry a faint tint so "what's new" is visible without
          // shouting; seen ones sit flat.
          item.isNew ? "bg-gradient-to-l from-card to-primary/[0.06]" : "bg-card",
          muted && "opacity-90"
        )}
      >
        {/* RTL: the tile is the first child so it sits at the START (right) of the
            card, with the text reading away from it. */}
        <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", TILE[item.severity] ?? TILE.info)}>
          <Icon className="h-4 w-4" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {item.isNew ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-label={t(inboxDict, locale, "newIndicator")} /> : null}
            <Link href={item.url} className="truncate text-sm font-semibold hover:underline">
              {item.title}
            </Link>
          </div>
          {item.content ? <p className="mt-0.5 text-xs text-muted-foreground">{item.content}</p> : null}

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <ClockIcon className="h-3 w-3 shrink-0" />
              {timeAgo(item.remindAt, locale)}
              {item.customerName ? <span>· {item.customerName}</span> : null}
              {item.assignedToName && muted ? <span>· {item.assignedToName}</span> : null}
              {mine ? <span className="rounded bg-primary/10 px-1 text-primary">{t(inboxDict, locale, "mine")}</span> : null}
            </span>

            {/* The destination stays a worded link (it's the point of the card);
                the row actions are icon-only so a list of them stays scannable
                instead of a wall of filled pills. */}
            <span className="flex items-center gap-0.5">
              <Link
                href={item.url}
                className="rounded-lg px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
              >
                {actionLabel(item, locale)}
              </Link>
              {snoozeOpen === item.id ? (
                <>
                  <Button size="sm" variant="secondary" className="h-7 px-2 text-xs" onClick={() => act(item.id, "snooze", preset("hour"))} disabled={busy === item.id}>
                    {t(inboxDict, locale, "presetHour")}
                  </Button>
                  <Button size="sm" variant="secondary" className="h-7 px-2 text-xs" onClick={() => act(item.id, "snooze", preset("tomorrow"))} disabled={busy === item.id}>
                    {t(inboxDict, locale, "presetTomorrow")}
                  </Button>
                  <Button size="sm" variant="secondary" className="h-7 px-2 text-xs" onClick={() => act(item.id, "snooze", preset("week"))} disabled={busy === item.id}>
                    {t(inboxDict, locale, "presetWeek")}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setSnoozeOpen(null)}>
                    {t(commonDict, locale, "cancel")}
                  </Button>
                </>
              ) : (
                <>
                  {mine ? (
                    <EditButton onClick={() =>
                        setEditing({ id: item.id, remindAt: item.remindAt, content: item.content, assignedTo: item.assignedTo })
                      } disabled={busy === item.id} label={t(inboxDict, locale, "editReminder")} />
                  ) : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground hover:bg-success/10 hover:text-success"
                    title={t(inboxDict, locale, "done")}
                    aria-label={t(inboxDict, locale, "markDoneAria")}
                    onClick={() => act(item.id, "done")}
                    disabled={busy === item.id}
                  >
                    <CheckIcon className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                    title={t(inboxDict, locale, "snoozeTitle")}
                    aria-label={t(inboxDict, locale, "snoozeAria")}
                    onClick={() => setSnoozeOpen(item.id)}
                    disabled={busy === item.id}
                  >
                    <ClockIcon className="h-4 w-4" />
                  </Button>
                </>
              )}
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header: what's here, and the two things you do to the list as a whole. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">{t(inboxDict, locale, "title")}</h1>
          <p className="text-xs text-muted-foreground">
            {inbox.counts.new > 0 ? `${inbox.counts.new} ${t(inboxDict, locale, "newLabel")} · ` : ""}
            {inbox.counts.all} {t(inboxDict, locale, "totalLabel")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {inbox.counts.new > 0 ? (
            <Button variant="ghost" size="sm" className="text-primary hover:bg-primary/10" onClick={markAllSeen} disabled={marking}>
              <CheckIcon className="h-4 w-4" />
              {t(inboxDict, locale, "markAllRead")}
            </Button>
          ) : null}
          {/* No "תזכורת" + button here — creating a reminder is a tile in the
              app's one quick-create +, which is on screen on this page too. */}
          <Button asChild variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
            <Link href="/profile#notifications">
              <SettingsIcon className="h-4 w-4" />
              {t(inboxDict, locale, "preferences")}
            </Link>
          </Button>
          {canSync ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground"
              onClick={runSync}
              disabled={syncing}
            >
              {syncing ? t(inboxDict, locale, "syncing") : t(inboxDict, locale, "refresh")}
            </Button>
          ) : null}
          {!hasPush ? <PushSubscribeButton /> : null}
        </div>
      </div>

      {/* Category chips — only the buckets that actually have something. */}
      {chips.length > 1 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setBucket(c.key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors",
                bucket === c.key
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background hover:bg-muted"
              )}
            >
              {c.label}
              <span
                className={cn(
                  "rounded-full px-1.5 text-[10px] font-semibold",
                  bucket === c.key ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground"
                )}
              >
                {c.count}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {visible.length === 0 && visibleSummaries.length === 0 ? (
        <div className="flex items-center gap-3 rounded-2xl border border-success/40 bg-success-soft px-5 py-4">
          <SuccessIcon className="h-7 w-7 shrink-0 text-success" />
          <div>
            <div className="font-semibold text-success-soft-foreground">{t(inboxDict, locale, "allCleanTitle")}</div>
            <div className="text-sm text-muted-foreground">{t(inboxDict, locale, "allCleanSubtitle")}</div>
          </div>
        </div>
      ) : null}

      {grouped.map((g) => (
        <section key={g.key} className="space-y-2">
          <h2 className="text-xs font-medium text-muted-foreground">{groupLabel(g.key, locale)}</h2>
          {g.items.map((item) => (
            <Card key={item.id} item={item} />
          ))}
        </section>
      ))}

      {visibleSummaries.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-xs font-medium text-muted-foreground">{t(inboxDict, locale, "summariesTitle")}</h2>
          {visibleSummaries.map((s) => (
            <Link
              key={s.id}
              href={s.href}
              className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-card px-3 py-3 transition-colors hover:bg-muted/40"
            >
              <span className="text-sm font-medium">{s.title}</span>
              <ChevronLeftIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
            </Link>
          ))}
        </section>
      ) : null}

      {visibleByMe.length > 0 && bucket === "all" ? (
        <section className="space-y-2">
          <h2 className="text-xs font-medium text-muted-foreground">{t(inboxDict, locale, "assignedByMeTitle")}</h2>
          {visibleByMe.map((item) => (
            <Card key={item.id} item={item} muted />
          ))}
        </section>
      ) : null}

      {visibleSnoozed.length > 0 ? (
        <section className="space-y-2">
          <button
            type="button"
            onClick={() => setShowSnoozed((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ClockIcon className="h-3.5 w-3.5" />
            {t(inboxDict, locale, "snoozedToggle").replace("{n}", String(visibleSnoozed.length))}
          </button>
          {showSnoozed
            ? visibleSnoozed.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border/60 bg-muted/20 px-3 py-2"
                >
                  <div className="min-w-0">
                    <Link href={item.url} className="text-sm font-medium hover:underline">
                      {item.title}
                    </Link>
                    <div className="text-[11px] text-muted-foreground">
                      {item.snoozedUntil
                        ? `${t(inboxDict, locale, "snoozedReturnsPrefix")} ${timeAgo(item.snoozedUntil, locale)}`
                        : t(inboxDict, locale, "snoozedLabel")}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="secondary" className="h-7 px-2 text-xs" onClick={() => act(item.id, "reopen")} disabled={busy === item.id}>
                      {t(inboxDict, locale, "restore")}
                    </Button>
                    <Button size="sm" className="h-7 px-2 text-xs" onClick={() => act(item.id, "done")} disabled={busy === item.id}>
                      {t(inboxDict, locale, "done")}
                    </Button>
                  </div>
                </div>
              ))
            : null}
        </section>
      ) : null}

      <div className="pt-1 text-center">
        <Link href="/notifications" className="text-xs text-muted-foreground hover:underline">
          {t(inboxDict, locale, "historyLink")}
        </Link>
      </div>

      <ReminderFormDialog
        mode="edit"
        open={editing !== null}
        onOpenChange={(v) => {
          if (!v) setEditing(null);
        }}
        value={editing ?? undefined}
        onSaved={() => {
          setEditing(null);
          refreshAlerts();
          router.refresh();
        }}
      />
    </div>
  );
}

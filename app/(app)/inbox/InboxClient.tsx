"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Banknote,
  Bell,
  Car,
  Check,
  CheckSquare,
  ChevronLeft,
  Clock,
  Coins,
  FolderKanban,
  Package,
  Pencil,
  Plus,
  Receipt,
  Settings2,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { toHebrewError } from "@/lib/error-messages";
import { refreshAlerts } from "@/lib/ui/alerts-store";
import { Button } from "@/components/ui/button";
import PushSubscribeButton from "@/components/notifications/PushSubscribeButton";
import ReminderFormDialog, { type ReminderFormValue } from "@/components/reminders/ReminderFormDialog";
import { cn } from "@/lib/utils";
import { NOTIF_BUCKETS } from "@/lib/notifications/categories";
import { inboxBucket, inboxOrigin, type InboxView, type WorklistItem, type WorklistSeverity } from "@/lib/reminders/worklist";

// Severity paints the icon tile; the rule picks the glyph. So colour answers
// "how bad is it" at a glance and the icon answers "what kind of thing is it".
const TILE: Record<WorklistSeverity, string> = {
  danger: "bg-destructive/10 text-destructive",
  warning: "bg-warning/15 text-warning",
  info: "bg-primary/10 text-primary",
};

const RULE_ICON: Record<string, typeof Bell> = {
  collection_overdue: Clock,
  payment_due_today: Coins,
  promise_broken: Clock,
  check_deposit_due: Banknote,
  recurring_expense_confirm: Receipt,
  task_overdue: CheckSquare,
  task_due_soon: CheckSquare,
  nightly_review: CheckSquare,
  project_deadline: FolderKanban,
  project_starting: FolderKanban,
  stale_quote: FolderKanban,
  project_closed_unbilled: FolderKanban,
  wage_overdue: Wallet,
  session_unallocated: Wallet,
  low_stock: Package,
  unprocessed_items: Package,
  vehicle_expiry: Car,
};

function iconFor(item: WorklistItem) {
  if (item.source === "manual") return Bell;
  const rule = (item.dedupeKey ?? "").split(":")[0];
  return RULE_ICON[rule] ?? Bell;
}

// The verb that matches the destination, so the link says what it does.
function actionLabel(item: WorklistItem): string {
  if (item.source === "manual") return "פתח";
  const rule = (item.dedupeKey ?? "").split(":")[0];
  if (rule.startsWith("task")) return "פתח משימה";
  if (rule.startsWith("project") || rule === "stale_quote") return "פתח פרויקט";
  if (rule === "check_deposit_due") return "פתח צ׳קים";
  if (rule === "low_stock") return "הזמן מלאי";
  if (rule === "unprocessed_items") return "פתח דף אשראי";
  if (rule === "vehicle_expiry") return "פתח רכב";
  if (rule === "wage_overdue" || rule === "session_unallocated") return "פתח שכר";
  if (rule === "recurring_expense_confirm") return "פתח הוצאה";
  return "פתח";
}

function timeAgo(iso: string): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return "עכשיו";
  if (mins < 60) return `לפני ${mins} דק׳`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `לפני ${hours} שעות`;
  const days = Math.round(hours / 24);
  if (days === 1) return "אתמול";
  if (days < 30) return `לפני ${days} ימים`;
  return new Intl.DateTimeFormat("he-IL", { day: "2-digit", month: "2-digit" }).format(t);
}

// Day buckets, so the list reads as a timeline rather than one long wall.
function dayGroup(iso: string): "today" | "yesterday" | "earlier" {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "earlier";
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (t.getTime() >= start.getTime()) return "today";
  const y = new Date(start);
  y.setDate(y.getDate() - 1);
  if (t.getTime() >= y.getTime()) return "yesterday";
  return "earlier";
}
const GROUP_LABEL: Record<string, string> = { today: "היום", yesterday: "אתמול", earlier: "קודם" };

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
}: {
  inbox: InboxView;
  assignedByMe?: WorklistItem[];
  canSync: boolean;
  hasPush: boolean;
}) {
  const router = useRouter();
  const [bucket, setBucket] = useState<string>("all");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [snoozeOpen, setSnoozeOpen] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [marking, setMarking] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
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
      { key: "all", label: "הכול", count: inbox.counts.all },
      ...NOTIF_BUCKETS.filter((b) => (inbox.byBucket[b.key] ?? 0) > 0).map((b) => ({
        key: b.key,
        label: b.label,
        count: inbox.byBucket[b.key] ?? 0,
      })),
    ],
    [inbox.byBucket, inbox.counts.all]
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
        action === "done" ? "סומן כבוצע" : action === "snooze" ? "נדחה" : action === "reopen" ? "הוחזר" : "הוסתר"
      );
      refreshAlerts();
      router.refresh();
    } catch (err) {
      setHidden((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      toast.error(toHebrewError(err, "הפעולה נכשלה."));
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
      toast.error(toHebrewError(err, "הפעולה נכשלה."));
    } finally {
      setMarking(false);
    }
  }

  async function runSync() {
    setSyncing(true);
    try {
      const res = await fetch("/api/reminders/sync-now", { method: "POST" });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error);
      toast.success("עודכן");
      refreshAlerts();
      router.refresh();
    } catch (err) {
      toast.error(toHebrewError(err, "העדכון נכשל."));
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
            {item.isNew ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-label="חדש" /> : null}
            <Link href={item.url} className="truncate text-sm font-semibold hover:underline">
              {item.title}
            </Link>
          </div>
          {item.content ? <p className="mt-0.5 text-xs text-muted-foreground">{item.content}</p> : null}

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Clock className="h-3 w-3 shrink-0" />
              {timeAgo(item.remindAt)}
              {item.customerName ? <span>· {item.customerName}</span> : null}
              {item.assignedToName && muted ? <span>· {item.assignedToName}</span> : null}
              {mine ? <span className="rounded bg-primary/10 px-1 text-primary">שלי</span> : null}
            </span>

            {/* The destination stays a worded link (it's the point of the card);
                the row actions are icon-only so a list of them stays scannable
                instead of a wall of filled pills. */}
            <span className="flex items-center gap-0.5">
              <Link
                href={item.url}
                className="rounded-lg px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
              >
                {actionLabel(item)}
              </Link>
              {snoozeOpen === item.id ? (
                <>
                  <Button size="sm" variant="secondary" className="h-7 px-2 text-xs" onClick={() => act(item.id, "snooze", preset("hour"))} disabled={busy === item.id}>
                    שעה
                  </Button>
                  <Button size="sm" variant="secondary" className="h-7 px-2 text-xs" onClick={() => act(item.id, "snooze", preset("tomorrow"))} disabled={busy === item.id}>
                    מחר
                  </Button>
                  <Button size="sm" variant="secondary" className="h-7 px-2 text-xs" onClick={() => act(item.id, "snooze", preset("week"))} disabled={busy === item.id}>
                    שבוע
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setSnoozeOpen(null)}>
                    ביטול
                  </Button>
                </>
              ) : (
                <>
                  {mine ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                      title="עריכה"
                      aria-label="עריכת תזכורת"
                      onClick={() =>
                        setEditing({ id: item.id, remindAt: item.remindAt, content: item.content, assignedTo: item.assignedTo })
                      }
                      disabled={busy === item.id}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground hover:bg-success/10 hover:text-success"
                    title="בוצע"
                    aria-label="סמן כבוצע"
                    onClick={() => act(item.id, "done")}
                    disabled={busy === item.id}
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                    title="דחה"
                    aria-label="דחיית התראה"
                    onClick={() => setSnoozeOpen(item.id)}
                    disabled={busy === item.id}
                  >
                    <Clock className="h-4 w-4" />
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
          <h1 className="text-xl font-bold">התראות</h1>
          <p className="text-xs text-muted-foreground">
            {inbox.counts.new > 0 ? `${inbox.counts.new} חדשות · ` : ""}
            {inbox.counts.all} סה״כ
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {inbox.counts.new > 0 ? (
            <Button variant="ghost" size="sm" className="text-primary hover:bg-primary/10" onClick={markAllSeen} disabled={marking}>
              <Check className="me-1 h-4 w-4" />
              סמן הכול כנקרא
            </Button>
          ) : null}
          {/* Only "תזכורת" is a real create action, so it's the one solid button;
              the rest are quiet so the header doesn't read as a row of pills. */}
          <Button asChild variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
            <Link href="/profile#notifications">
              <Settings2 className="me-1 h-4 w-4" />
              העדפות
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
              {syncing ? "מעדכן…" : "רענן"}
            </Button>
          ) : null}
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="me-1 h-4 w-4" />
            תזכורת
          </Button>
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
          <div className="text-2xl">✓</div>
          <div>
            <div className="font-semibold text-success-soft-foreground">הכול נקי</div>
            <div className="text-sm text-muted-foreground">אין מה לטפל כרגע.</div>
          </div>
        </div>
      ) : null}

      {grouped.map((g) => (
        <section key={g.key} className="space-y-2">
          <h2 className="text-xs font-medium text-muted-foreground">{GROUP_LABEL[g.key]}</h2>
          {g.items.map((item) => (
            <Card key={item.id} item={item} />
          ))}
        </section>
      ))}

      {visibleSummaries.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-xs font-medium text-muted-foreground">סיכומים</h2>
          {visibleSummaries.map((s) => (
            <Link
              key={s.id}
              href={s.href}
              className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-card px-3 py-3 transition-colors hover:bg-muted/40"
            >
              <span className="text-sm font-medium">{s.title}</span>
              <ChevronLeft className="h-4 w-4 shrink-0 text-muted-foreground" />
            </Link>
          ))}
        </section>
      ) : null}

      {visibleByMe.length > 0 && bucket === "all" ? (
        <section className="space-y-2">
          <h2 className="text-xs font-medium text-muted-foreground">תזכורות שהקצאתי לאחרים</h2>
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
            <Clock className="h-3.5 w-3.5" />
            נדחו לזמן מאוחר ({visibleSnoozed.length})
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
                      {item.snoozedUntil ? `חוזר ${timeAgo(item.snoozedUntil)}` : "נדחה"}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="secondary" className="h-7 px-2 text-xs" onClick={() => act(item.id, "reopen")} disabled={busy === item.id}>
                      החזר
                    </Button>
                    <Button size="sm" className="h-7 px-2 text-xs" onClick={() => act(item.id, "done")} disabled={busy === item.id}>
                      בוצע
                    </Button>
                  </div>
                </div>
              ))
            : null}
        </section>
      ) : null}

      <div className="pt-1 text-center">
        <Link href="/notifications" className="text-xs text-muted-foreground hover:underline">
          היסטוריית התראות שנשלחו
        </Link>
      </div>

      <ReminderFormDialog
        mode="create"
        open={addOpen}
        onOpenChange={setAddOpen}
        links={{}}
        category="general"
        onSaved={() => {
          refreshAlerts();
          router.refresh();
        }}
      />
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

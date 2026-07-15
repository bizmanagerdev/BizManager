"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, BellOff, BellRing, ChevronLeft, Clock } from "lucide-react";
import { toast } from "sonner";
import { toHebrewError } from "@/lib/error-messages";
import { refreshAlerts } from "@/lib/ui/alerts-store";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import PushSubscribeButton from "@/components/notifications/PushSubscribeButton";
import WorklistCustomizer from "@/app/(app)/alerts/WorklistCustomizer";
import ReminderFormDialog, { type ReminderFormValue } from "@/components/reminders/ReminderFormDialog";
import { cn } from "@/lib/utils";
import type { WorklistItem, WorklistPrefs, WorklistSectionView, WorklistSeverity } from "@/lib/reminders/worklist";

const SEVERITY = {
  danger: { border: "border-destructive/40", bg: "bg-destructive/5", dot: "bg-destructive" },
  warning: { border: "border-warning/40", bg: "bg-warning/5", dot: "bg-warning" },
  info: { border: "border-border", bg: "bg-secondary/10", dot: "bg-muted-foreground/40" },
};

function fmt(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("he-IL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);
}

// What (if anything) will reach the phone for this item, and when.
function notifyInfo(item: WorklistItem, hasPush: boolean): { Icon: typeof Bell; text: string; muted: boolean } {
  if (item.behavior === "silent") return { Icon: BellOff, text: "ללא התראה לנייד", muted: true };
  if (!hasPush) return { Icon: BellOff, text: "התראות לנייד כבויות", muted: true };
  if (item.notifiedAt) return { Icon: BellRing, text: "התראה נשלחה", muted: true };
  if (item.behavior === "ping_repeat") {
    return { Icon: Bell, text: item.nextPingAt ? `התראה יומית · הבאה ${fmt(item.nextPingAt)}` : "התראה יומית לנייד", muted: false };
  }
  // ping_once: manual fires at remind_at; system schedules on the next cron run.
  if (item.source === "manual" && item.remindAt) return { Icon: Bell, text: `התראה לנייד ${fmt(item.remindAt)}`, muted: false };
  return { Icon: Bell, text: item.nextPingAt ? `התראה לנייד ${fmt(item.nextPingAt)}` : "התראה לנייד בקרוב", muted: false };
}

// Snooze presets return an explicit future ISO timestamp.
function preset(kind: "hour" | "tomorrow" | "week"): string {
  const d = new Date();
  if (kind === "hour") d.setHours(d.getHours() + 1);
  else if (kind === "tomorrow") {
    d.setDate(d.getDate() + 1);
    d.setHours(8, 0, 0, 0);
  } else {
    d.setDate(d.getDate() + 7);
  }
  return d.toISOString();
}

export default function WorklistClient({
  sections,
  assignedByMe = [],
  canSync,
  hasPush,
  prefs,
}: {
  sections: WorklistSectionView[];
  assignedByMe?: WorklistItem[];
  canSync: boolean;
  hasPush: boolean;
  prefs: WorklistPrefs | null;
}) {
  const router = useRouter();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [snoozeOpen, setSnoozeOpen] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [editing, setEditing] = useState<ReminderFormValue | null>(null);

  // Drop optimistically-actioned items; keep only sections that still have content.
  const visibleSections = useMemo(
    () =>
      sections
        .map((s) => ({ ...s, items: s.items.filter((i) => !hidden.has(i.id)) }))
        .filter((s) => s.items.length > 0 || s.summaries.length > 0),
    [sections, hidden]
  );
  // Reminders I created for other people (tracking) — drop optimistically-actioned.
  const visibleAssignedByMe = useMemo(
    () => assignedByMe.filter((i) => !hidden.has(i.id)),
    [assignedByMe, hidden]
  );
  // "All clear" ignores the snoozed section — snoozed items aren't active work.
  const activeCount = visibleSections
    .filter((s) => s.key !== "snoozed")
    .reduce((n, s) => n + s.items.length + s.summaries.length, 0);
  const allClear = activeCount === 0;

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
          ? "סומן כבוצע"
          : action === "snooze"
            ? "נדחה למועד מאוחר יותר"
            : action === "reopen"
              ? "הוחזר לרשימה"
              : "הוסתר"
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

  async function runSync() {
    setSyncing(true);
    try {
      const res = await fetch("/api/reminders/sync-now", { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error);
      toast.success("ההתראות עודכנו");
      refreshAlerts();
      router.refresh();
    } catch (err) {
      toast.error(toHebrewError(err, "עדכון ההתראות נכשל."));
    } finally {
      setSyncing(false);
    }
  }

  function SnoozedRow({ item }: { item: WorklistItem }) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 bg-muted/20 px-4 py-2.5">
        <div className="min-w-0">
          <Link href={item.url} className="text-sm font-medium hover:underline">
            {item.title}
          </Link>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5 shrink-0" />
            <span>{item.snoozedUntil ? `חוזר ומתריע ${fmt(item.snoozedUntil)}` : "נדחה"}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => act(item.id, "reopen")} disabled={busy === item.id}>
            החזר עכשיו
          </Button>
          <Button size="sm" onClick={() => act(item.id, "done")} disabled={busy === item.id}>
            בוצע
          </Button>
        </div>
      </div>
    );
  }

  function ItemCard({ item }: { item: WorklistItem }) {
    const cfg = SEVERITY[item.severity as WorklistSeverity] ?? SEVERITY.info;
    const notify = notifyInfo(item, hasPush);
    return (
      <div className={`rounded-xl border p-4 ${cfg.border} ${cfg.bg}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${cfg.dot}`} />
            <div className="space-y-0.5">
              <Link href={item.url} className="font-semibold hover:underline">
                {item.title}
              </Link>
              {item.content && <div className="text-sm text-muted-foreground">{item.content}</div>}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                {item.customerName && (
                  <span>
                    {item.customerName}
                    {item.customerPhone ? ` · ${item.customerPhone}` : ""}
                  </span>
                )}
                {item.source === "manual" && item.remindAt && <span>{fmt(item.remindAt)}</span>}
                {item.assignedToName && <span>· {item.assignedToName}</span>}
              </div>
              <div className={`flex items-center gap-1 text-xs ${notify.muted ? "text-muted-foreground/70" : "text-primary"}`}>
                <notify.Icon className="h-3.5 w-3.5 shrink-0" />
                <span>{notify.text}</span>
              </div>
            </div>
          </div>
          <Button asChild variant="secondary" size="sm" className="shrink-0">
            <Link href={item.url}>פתח</Link>
          </Button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => act(item.id, "done")} disabled={busy === item.id}>
            בוצע
          </Button>
          {snoozeOpen === item.id ? (
            <div className="flex items-center gap-1">
              <Button variant="secondary" size="sm" onClick={() => act(item.id, "snooze", preset("hour"))} disabled={busy === item.id}>
                שעה
              </Button>
              <Button variant="secondary" size="sm" onClick={() => act(item.id, "snooze", preset("tomorrow"))} disabled={busy === item.id}>
                מחר
              </Button>
              <Button variant="secondary" size="sm" onClick={() => act(item.id, "snooze", preset("week"))} disabled={busy === item.id}>
                שבוע
              </Button>
            </div>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => setSnoozeOpen(item.id)} disabled={busy === item.id}>
              דחה
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => act(item.id, "dismiss")} disabled={busy === item.id}>
            {item.source === "system" ? "הסתר להיום" : "בטל"}
          </Button>
          {item.source === "manual" ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                setEditing({ id: item.id, remindAt: item.remindAt, content: item.content, assignedTo: item.assignedTo })
              }
              disabled={busy === item.id}
            >
              ערוך
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <WorklistCustomizer initialPrefs={prefs} />
        {canSync && (
          <Button variant="secondary" size="sm" onClick={runSync} disabled={syncing}>
            {syncing ? "מעדכן…" : "רענן התראות"}
          </Button>
        )}
        <PushSubscribeButton />
      </div>

      {allClear && (
        <div className="flex items-center gap-3 rounded-xl border border-success/40 bg-success-soft px-5 py-4">
          <div className="text-2xl">✓</div>
          <div>
            <div className="font-semibold text-success-soft-foreground">הכול יציב</div>
            <div className="text-sm text-muted-foreground">אין פריטים שדורשים טיפול כרגע.</div>
          </div>
        </div>
      )}

      {visibleSections.map((section) => (
        <Card key={section.key}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{section.title}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {section.items.map((item) =>
              section.key === "snoozed" ? <SnoozedRow key={item.id} item={item} /> : <ItemCard key={item.id} item={item} />
            )}
            {section.summaries.map((s) => {
              const cfg = SEVERITY[s.severity as WorklistSeverity] ?? SEVERITY.info;
              return (
                <Link
                  key={s.id}
                  href={s.href}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border/60 px-4 py-3 transition-colors hover:bg-muted/40"
                >
                  <div className="flex items-center gap-3">
                    <div className={cn("h-2.5 w-2.5 shrink-0 rounded-full", cfg.dot)} />
                    <span className="text-sm font-medium">{s.title}</span>
                  </div>
                  <ChevronLeft className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              );
            })}
          </CardContent>
        </Card>
      ))}

      {visibleAssignedByMe.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">תזכורות שהקצאתי לאחרים</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {visibleAssignedByMe.map((item) => (
              <ItemCard key={item.id} item={item} />
            ))}
          </CardContent>
        </Card>
      )}

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

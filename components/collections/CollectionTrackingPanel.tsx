"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Textarea } from "@/components/ui/textarea";
import { formatShortDate } from "@/lib/date";
import { collectionStatusClasses, collectionStatusLabel } from "@/lib/orders/paymentStatus";
import type { CustomerReceivable } from "@/lib/collections";
import {
  COMMUNICATION_CHANNELS,
  actionTypeLabel,
  channelLabel,
  directionLabel,
  type CommunicationLog,
  type Reminder,
} from "@/lib/communications";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 0,
  }).format(value);
}

type Props = {
  customerId: string;
  customerName: string;
  customerPhone?: string | null;
  /** Called after any successful mutation, so a parent list can refresh. */
  onChanged?: () => void;
};

function formatDateTime(value: string | null) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("he-IL", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function isOverdue(remindAt: string) {
  return remindAt.slice(0, 10) < todayIso();
}

export default function CollectionTrackingPanel({
  customerId,
  customerName,
  customerPhone,
  onChanged,
}: Props) {
  const [logs, setLogs] = useState<CommunicationLog[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [receivables, setReceivables] = useState<CustomerReceivable[]>([]);
  const [collectingId, setCollectingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Log-call form
  const [channel, setChannel] = useState("phone");
  const [direction, setDirection] = useState("outgoing");
  const [content, setContent] = useState("");
  const [withFollowUp, setWithFollowUp] = useState(false);
  const [followUpDate, setFollowUpDate] = useState("");
  const [followUpContent, setFollowUpContent] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/collections/activity?customer_id=${encodeURIComponent(customerId)}`
      );
      const json = (await res.json().catch(() => ({}))) as {
        logs?: CommunicationLog[];
        reminders?: Reminder[];
        receivables?: CustomerReceivable[];
        error?: string;
      };
      if (!res.ok) {
        setError(json.error ?? "טעינה נכשלה");
        return;
      }
      setLogs(json.logs ?? []);
      setReminders(json.reminders ?? []);
      setReceivables(json.receivables ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה לא ידועה");
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function logCall() {
    if (submitting) return;
    if (!content.trim() && !withFollowUp) {
      setError("יש להזין תוכן שיחה או לקבוע תזכורת.");
      return;
    }
    if (withFollowUp && !followUpDate) {
      setError("יש לבחור תאריך לתזכורת ההמשך.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/communications/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customer_id: customerId,
          channel,
          direction,
          content: content.trim() || undefined,
          follow_up: withFollowUp
            ? { remind_at: followUpDate, content: followUpContent.trim() || undefined }
            : undefined,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? "שמירה נכשלה");
        return;
      }
      setContent("");
      setWithFollowUp(false);
      setFollowUpDate("");
      setFollowUpContent("");
      await load();
      onChanged?.();
    } finally {
      setSubmitting(false);
    }
  }

  async function updateReminder(id: string, status: "done" | "cancelled") {
    const res = await fetch("/api/reminders/update", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    if (res.ok) {
      await load();
      onChanged?.();
    }
  }

  async function markCollected(paymentId: string) {
    setCollectingId(paymentId);
    try {
      const res = await fetch("/api/payments/mark-collected", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: paymentId, collected: true }),
      });
      if (res.ok) {
        await load();
        onChanged?.();
      }
    } finally {
      setCollectingId(null);
    }
  }

  const totalOutstanding = receivables.reduce((sum, r) => sum + r.outstanding_amount, 0);

  const openReminders = reminders.filter((r) => r.status === "pending");

  return (
    <div className="space-y-4 text-right" dir="rtl">
      <div className="text-sm text-muted-foreground">
        {customerName}
        {customerPhone ? (
          <>
            {" · "}
            <a href={`tel:${customerPhone}`} className="hover:underline">
              ☎ {customerPhone}
            </a>
          </>
        ) : null}
      </div>

      {/* What the customer owes — collected vs expected, with mark-collected */}
      {receivables.length > 0 ? (
        <div className="rounded-xl border border-border/70 bg-background/60 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold">מה חייב</span>
            <span className="text-sm font-semibold">{formatCurrency(totalOutstanding)}</span>
          </div>
          <div className="space-y-2">
            {receivables.map((r) => {
              const fallbackTitle =
                r.source_type === "order"
                  ? `הזמנה #${r.source_id.slice(0, 8)}`
                  : `פרויקט #${r.source_id.slice(0, 8)}`;
              return (
                <div
                  key={r.collection_key}
                  className="rounded-lg border border-border/60 bg-background/50 p-2 text-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium">{r.title ?? fallbackTitle}</span>
                      <Badge className={collectionStatusClasses(r.collection_status)}>
                        {collectionStatusLabel(r.collection_status)}
                      </Badge>
                    </div>
                    <span className="font-semibold">{formatCurrency(r.outstanding_amount)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                    <span>תאריך: {r.reference_date ? formatShortDate(r.reference_date) : "—"}</span>
                    {r.days_late > 0 ? (
                      <span className="text-destructive">{r.days_late} ימים באיחור</span>
                    ) : null}
                  </div>
                  {r.pending_payments.length > 0 ? (
                    <div className="mt-2 space-y-1 border-t border-border/50 pt-2">
                      {r.pending_payments.map((p) => (
                        <div key={p.id} className="flex items-center justify-between gap-2">
                          <span className={p.overdue ? "text-destructive" : "text-muted-foreground"}>
                            {formatCurrency(p.amount)} · פירעון{" "}
                            {p.due_date ? formatShortDate(p.due_date) : "—"}
                            {p.overdue ? " (באיחור)" : ""}
                          </span>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 shrink-0 text-xs"
                            disabled={collectingId === p.id}
                            onClick={() => void markCollected(p.id)}
                          >
                            {collectingId === p.id ? "מסמן..." : "סמן כנגבה"}
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Log a call */}
      <div className="rounded-xl border border-border/70 bg-background/60 p-3">
        <div className="mb-2 text-sm font-semibold">תיעוד שיחה</div>
        <div className="grid gap-2 sm:grid-cols-2">
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            {COMMUNICATION_CHANNELS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="outgoing">שיחה יוצאת</option>
            <option value="incoming">שיחה נכנסת</option>
          </select>
        </div>
        <Textarea
          className="mt-2"
          rows={2}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="מה סוכם? מה הלקוח אמר?"
        />

        <label className="mt-2 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={withFollowUp}
            onChange={(e) => setWithFollowUp(e.target.checked)}
          />
          קבע תזכורת המשך
        </label>
        {withFollowUp ? (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <DateInput value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} />
            <input
              value={followUpContent}
              onChange={(e) => setFollowUpContent(e.target.value)}
              placeholder="להתקשר שוב..."
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
        ) : null}

        {error ? <div className="mt-2 text-sm text-destructive">{error}</div> : null}

        <div className="mt-3 flex justify-end">
          <Button type="button" size="sm" onClick={() => void logCall()} disabled={submitting}>
            {submitting ? "שומר..." : "שמירה"}
          </Button>
        </div>
      </div>

      {/* Open reminders */}
      <div>
        <div className="mb-2 text-sm font-semibold">תזכורות פתוחות ({openReminders.length})</div>
        {openReminders.length === 0 ? (
          <p className="text-sm text-muted-foreground">אין תזכורות פתוחות.</p>
        ) : (
          <div className="space-y-2">
            {openReminders.map((r) => (
              <div
                key={r.id}
                className={`rounded-lg border p-2 text-sm ${
                  isOverdue(r.remind_at) ? "border-destructive/40 bg-destructive-soft/40" : "border-border/70"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {actionTypeLabel(r.action_type)} · {formatShortDate(r.remind_at)}
                    {isOverdue(r.remind_at) ? (
                      <span className="ms-1 text-xs text-destructive">(באיחור)</span>
                    ) : null}
                  </span>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => void updateReminder(r.id, "done")}
                    >
                      בוצע
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={() => void updateReminder(r.id, "cancelled")}
                    >
                      בטל
                    </Button>
                  </div>
                </div>
                {r.content ? <div className="mt-1 text-muted-foreground">{r.content}</div> : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Communication timeline */}
      <div>
        <div className="mb-2 text-sm font-semibold">היסטוריית שיחות</div>
        {loading ? (
          <p className="text-sm text-muted-foreground">טוען...</p>
        ) : logs.length === 0 ? (
          <p className="text-sm text-muted-foreground">עדיין לא תועדו שיחות.</p>
        ) : (
          <div className="space-y-2">
            {logs.map((log) => (
              <div key={log.id} className="rounded-lg border border-border/60 bg-background/50 p-2 text-sm">
                <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  <span>{channelLabel(log.channel)}</span>
                  <span>· {directionLabel(log.direction)}</span>
                  <span>· {formatDateTime(log.created_at)}</span>
                  {log.created_by_name ? <span>· {log.created_by_name}</span> : null}
                </div>
                {log.content ? <div className="mt-1">{log.content}</div> : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

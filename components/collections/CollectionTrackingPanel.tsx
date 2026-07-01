"use client";
import { toHebrewError } from "@/lib/error-messages";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BellRing, Check, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateTimeInput } from "@/components/ui/date-input";
import { Textarea } from "@/components/ui/textarea";
import { formatShortDate, formatShortDateTime } from "@/lib/date";
import { collectionStatusClasses, collectionStatusLabel, paymentMethodLabel } from "@/lib/orders/paymentStatus";
import { paymentTermsLabel } from "@/lib/paymentTerms";
import type { CustomerReceivable } from "@/lib/collections";
import CommunicationLogItem from "@/components/collections/CommunicationLogItem";
import { AssigneeSelect } from "@/components/collections/AssigneeSelect";
import EditReminderDialog from "@/components/collections/EditReminderDialog";
import { useAssignableUsers } from "@/hooks/useAssignableUsers";
import {
  COMMUNICATION_CHANNELS,
  actionTypeLabel,
  type CommunicationLog,
  type Reminder,
} from "@/lib/communications";
import { offlineFetch } from "@/lib/offline-queue";

// Same format as the customer page: no trailing ".00", decimals only when real.
function formatCurrency(value: number) {
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

type Props = {
  customerId: string;
  customerName: string;
  customerPhone?: string | null;
  /** Called after any successful mutation, so a parent list can refresh. */
  onChanged?: () => void;
  /**
   * Start the log-call / add-reminder forms collapsed behind "+" buttons and
   * collapse them again after a save (used when the panel is embedded inline
   * on the customer page rather than opened in a dedicated dialog).
   */
  collapsibleForms?: boolean;
};

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
  collapsibleForms = false,
}: Props) {
  const [showCallForm, setShowCallForm] = useState(!collapsibleForms);
  const [showReminderForm, setShowReminderForm] = useState(!collapsibleForms);
  const [logs, setLogs] = useState<CommunicationLog[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [receivables, setReceivables] = useState<CustomerReceivable[]>([]);
  const [collectingId, setCollectingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { currentUserId } = useAssignableUsers();

  // Log-call form
  const [channel, setChannel] = useState("phone");
  const [direction, setDirection] = useState("outgoing");
  const [content, setContent] = useState("");
  const [withFollowUp, setWithFollowUp] = useState(false);
  const [followUpDate, setFollowUpDate] = useState("");
  const [followUpContent, setFollowUpContent] = useState("");
  const [followUpAssignee, setFollowUpAssignee] = useState("");
  const [reminderDate, setReminderDate] = useState("");
  const [reminderNote, setReminderNote] = useState("");
  const [reminderAssignee, setReminderAssignee] = useState("");
  const [editingReminder, setEditingReminder] = useState<Reminder | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Default both assignee pickers to the current user once the list resolves.
  useEffect(() => {
    if (!currentUserId) return;
    setFollowUpAssignee((prev) => prev || currentUserId);
    setReminderAssignee((prev) => prev || currentUserId);
  }, [currentUserId]);

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
        setError(toHebrewError(json.error, "טעינה נכשלה"));
        return;
      }
      setLogs(json.logs ?? []);
      setReminders(json.reminders ?? []);
      setReceivables(json.receivables ?? []);
    } catch (err) {
      setError(toHebrewError(err, "שגיאה לא ידועה"));
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
      setError("יש לבחור תאריך ושעה לתזכורת ההמשך.");
      return;
    }
    function resetCallForm() {
      setContent("");
      setWithFollowUp(false);
      setFollowUpDate("");
      setFollowUpContent("");
      setFollowUpAssignee(currentUserId ?? "");
      if (collapsibleForms) setShowCallForm(false);
    }

    setSubmitting(true);
    setError(null);
    try {
      const result = await offlineFetch(
        "/api/communications/create",
        {
          customer_id: customerId,
          channel,
          direction,
          content: content.trim() || undefined,
          follow_up: withFollowUp
            ? {
                remind_at: new Date(followUpDate).toISOString(),
                content: followUpContent.trim() || undefined,
                assigned_to: followUpAssignee || undefined,
              }
            : undefined,
        },
        "תיעוד שיחה",
        { idempotent: true }
      );
      if (result.queued) {
        resetCallForm();
        onChanged?.();
        return;
      }
      if (!result.ok) {
        setError(toHebrewError(result.error, "שמירה נכשלה"));
        return;
      }
      toast.success(withFollowUp ? "השיחה תועדה ותזכורת המשך נקבעה" : "השיחה תועדה");
      resetCallForm();
      await load();
      onChanged?.();
    } finally {
      setSubmitting(false);
    }
  }

  async function addReminder() {
    if (submitting) return;
    if (!reminderDate) {
      setError("יש לבחור תאריך ושעה לתזכורת.");
      return;
    }
    function resetReminderForm() {
      setReminderDate("");
      setReminderNote("");
      setReminderAssignee(currentUserId ?? "");
      if (collapsibleForms) setShowReminderForm(false);
    }

    setSubmitting(true);
    setError(null);
    try {
      const result = await offlineFetch(
        "/api/reminders/create",
        {
          customer_id: customerId,
          remind_at: new Date(reminderDate).toISOString(),
          content: reminderNote.trim() || undefined,
          action_type: "call",
          category: "collection",
          assigned_to: reminderAssignee || undefined,
        },
        "תזכורת חדשה",
        { idempotent: true }
      );
      if (result.queued) {
        resetReminderForm();
        onChanged?.();
        return;
      }
      if (!result.ok) {
        setError(toHebrewError(result.error, "שמירת התזכורת נכשלה"));
        return;
      }
      toast.success("התזכורת נוספה");
      resetReminderForm();
      await load();
      onChanged?.();
    } finally {
      setSubmitting(false);
    }
  }

  async function updateReminder(id: string, status: "done" | "cancelled") {
    const result = await offlineFetch(
      "/api/reminders/update",
      { id, status },
      status === "done" ? "סימון תזכורת כבוצעה" : "ביטול תזכורת"
    );
    if (result.queued) {
      onChanged?.();
      return;
    }
    if (result.ok) {
      toast.success(status === "done" ? "התזכורת סומנה כבוצעה" : "התזכורת בוטלה");
      await load();
      onChanged?.();
    } else {
      toast.error("עדכון התזכורת נכשל", { description: toHebrewError(result.error, "") });
    }
  }

  async function markCollected(paymentId: string) {
    setCollectingId(paymentId);
    try {
      const result = await offlineFetch(
        "/api/payments/mark-collected",
        { id: paymentId, collected: true },
        "סימון תשלום כנגבה"
      );
      if (result.queued) {
        return;
      }
      if (result.ok) {
        toast.success("התשלום סומן כנגבה");
        await load();
        onChanged?.();
      } else {
        toast.error("סימון התשלום נכשל", { description: toHebrewError(result.error, "") });
      }
    } finally {
      setCollectingId(null);
    }
  }


  const totalOutstanding = receivables.reduce((sum, r) => sum + r.outstanding_amount, 0);

  const openReminders = reminders.filter((r) => r.status === "pending");

  // The two entry forms — placed near the top in dialog mode, near the footer
  // action bar in the inline (collapsible) mode so they open where the buttons are.
  const callFormBlock = showCallForm ? (
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
        <div className="mt-2 space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <DateTimeInput value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} />
            <input
              value={followUpContent}
              onChange={(e) => setFollowUpContent(e.target.value)}
              placeholder="להתקשר שוב..."
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">אחראי לתזכורת</div>
            <AssigneeSelect value={followUpAssignee} onChange={setFollowUpAssignee} includeMeDefault />
          </div>
        </div>
      ) : null}

      {error ? <div className="mt-2 text-sm text-destructive">{error}</div> : null}

      <div className="mt-3 flex justify-end gap-2">
        {collapsibleForms ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => setShowCallForm(false)}
            disabled={submitting}
          >
            סגירה
          </Button>
        ) : null}
        <Button type="button" size="sm" onClick={() => void logCall()} disabled={submitting}>
          {submitting ? "שומר..." : "שמירה"}
        </Button>
      </div>
    </div>
  ) : null;

  const reminderFormBlock = showReminderForm ? (
    <div className="rounded-xl border border-border/70 bg-background/60 p-3">
      <div className="mb-2 text-sm font-semibold">קביעת תזכורת</div>
      <div className="grid gap-2 sm:grid-cols-2">
        <DateTimeInput value={reminderDate} onChange={(e) => setReminderDate(e.target.value)} />
        <input
          value={reminderNote}
          onChange={(e) => setReminderNote(e.target.value)}
          placeholder="על מה להזכיר? (אופציונלי)"
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        />
      </div>
      <div className="mt-2 space-y-1">
        <div className="text-xs text-muted-foreground">אחראי</div>
        <AssigneeSelect value={reminderAssignee} onChange={setReminderAssignee} includeMeDefault />
      </div>
      {error ? <div className="mt-2 text-sm text-destructive">{error}</div> : null}
      <div className="mt-3 flex justify-end gap-2">
        {collapsibleForms ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => setShowReminderForm(false)}
            disabled={submitting}
          >
            סגירה
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          onClick={() => void addReminder()}
          disabled={submitting}
        >
          {submitting ? "שומר..." : "הוספת תזכורת"}
        </Button>
      </div>
    </div>
  ) : null;

  return (
    <div className="space-y-4 text-right" dir="rtl">
      {!collapsibleForms ? (
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
      ) : null}

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
                  : r.source_type === "loan"
                    ? "הלוואה"
                    : `פרויקט #${r.source_id.slice(0, 8)}`;
              return (
                <div
                  key={r.collection_key}
                  className="rounded-lg border border-border/60 bg-background/50 p-2 text-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium">
                        {r.source_type === "loan"
                          ? r.title
                            ? `הלוואה — ${r.title}`
                            : "הלוואה"
                          : r.title ?? fallbackTitle}
                      </span>
                      <Badge className={collectionStatusClasses(r.collection_status)}>
                        {collectionStatusLabel(r.collection_status)}
                      </Badge>
                    </div>
                    <span className="font-semibold">{formatCurrency(r.outstanding_amount)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                    <span>תאריך: {r.reference_date ? formatShortDate(r.reference_date) : "—"}</span>
                    {r.payment_terms ? <span>צורת תשלום: {paymentTermsLabel(r.payment_terms)}</span> : null}
                    {r.due_date || r.next_due_date ? (
                      <span>פירעון: {formatShortDate((r.due_date ?? r.next_due_date) as string)}</span>
                    ) : null}
                    {r.days_late > 0 ? (
                      <span className="text-destructive">{r.days_late} ימים באיחור</span>
                    ) : null}
                  </div>
                  {r.source_type === "loan" ? (
                    <div className="mt-2 flex justify-end border-t border-border/50 pt-2">
                      <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                        <Link href={`/financial/loans?repay=${r.source_id}`}>רישום החזר</Link>
                      </Button>
                    </div>
                  ) : null}
                  {r.pending_payments.length > 0 ? (
                    <div className="mt-2 space-y-1 border-t border-border/50 pt-2">
                      {r.pending_payments.map((p) => (
                        <div key={p.id} className="flex items-center justify-between gap-2">
                          <span className={p.overdue ? "text-destructive" : "text-muted-foreground"}>
                            {formatCurrency(p.amount)} · פירעון{" "}
                            {p.due_date ? formatShortDate(p.due_date) : "—"}
                            {p.payment_method ? ` · ${paymentMethodLabel(p.payment_method)}` : ""}
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

      {/* Dialog mode: forms live at the top, always open */}
      {!collapsibleForms ? callFormBlock : null}
      {!collapsibleForms ? reminderFormBlock : null}

      {/* Open reminders */}
      <div>
        <div className="mb-2 text-xs font-semibold text-muted-foreground">
          תזכורות פתוחות ({openReminders.length})
        </div>
        {openReminders.length === 0 ? (
          <p className="text-sm text-muted-foreground">אין תזכורות פתוחות.</p>
        ) : (
          <div className="space-y-2">
            {openReminders.map((r) => {
              const overdue = isOverdue(r.remind_at);
              return (
                <div
                  key={r.id}
                  className={`flex flex-wrap items-start justify-between gap-2 rounded-xl border p-3 text-sm ${
                    overdue ? "border-destructive/40 bg-destructive-soft/40" : "border-border/70 bg-background/60"
                  }`}
                >
                  <div className="flex min-w-0 items-start gap-2.5">
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                        overdue
                          ? "bg-destructive-soft text-destructive"
                          : "bg-warning-soft text-warning-soft-foreground"
                      }`}
                    >
                      <BellRing className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="font-semibold">{r.content || actionTypeLabel(r.action_type)}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {actionTypeLabel(r.action_type)} · מתוזמן ל-{formatShortDateTime(r.remind_at)}
                        {overdue ? <span className="text-destructive"> (באיחור)</span> : null}
                        {r.assigned_to_name ? ` · ${r.assigned_to_name}` : ""}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 rounded-full px-3 text-xs"
                      title="סימון כבוצע"
                      onClick={() => void updateReminder(r.id, "done")}
                    >
                      <Check className="h-3.5 w-3.5" />
                      בוצע
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 rounded-full border border-border/60 bg-background"
                      title="עריכת תזכורת"
                      aria-label="עריכת תזכורת"
                      onClick={() => setEditingReminder(r)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 rounded-full border border-border/60 bg-background text-muted-foreground"
                      title="ביטול תזכורת"
                      aria-label="ביטול תזכורת"
                      onClick={() => void updateReminder(r.id, "cancelled")}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Communication timeline */}
      <div>
        <div className="mb-2 text-xs font-semibold text-muted-foreground">היסטוריית שיחות</div>
        {loading ? (
          <p className="text-sm text-muted-foreground">טוען...</p>
        ) : logs.length === 0 ? (
          <p className="text-sm text-muted-foreground">עדיין לא תועדו שיחות.</p>
        ) : (
          <div className="space-y-2">
            {logs.map((log) => (
              <CommunicationLogItem
                key={log.id}
                log={log}
                onChanged={() => {
                  void load();
                  onChanged?.();
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Inline mode: forms open next to the footer action bar */}
      {collapsibleForms ? callFormBlock : null}
      {collapsibleForms ? reminderFormBlock : null}
      {collapsibleForms && (!showCallForm || !showReminderForm) ? (
        <div className="flex flex-wrap justify-end gap-2 border-t border-border/50 pt-3">
          {!showReminderForm ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="border border-primary/20 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary"
              onClick={() => setShowReminderForm(true)}
            >
              + תזכורת
            </Button>
          ) : null}
          {!showCallForm ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="border border-primary/20 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary"
              onClick={() => setShowCallForm(true)}
            >
              + תיעוד שיחה
            </Button>
          ) : null}
        </div>
      ) : null}

      <EditReminderDialog
        reminder={editingReminder}
        open={Boolean(editingReminder)}
        onOpenChange={(o) => {
          if (!o) setEditingReminder(null);
        }}
        onSaved={() => {
          void load();
          onChanged?.();
        }}
      />
    </div>
  );
}

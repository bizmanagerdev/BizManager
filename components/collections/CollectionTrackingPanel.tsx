"use client";
import { toHebrewError } from "@/lib/error-messages";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { AddIcon, CheckIcon, CloseIcon, PhoneIcon, ReminderIcon } from "@/components/ui/icons";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { DateTimeInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DictateButton } from "@/components/ui/dictate-button";
import { ContactLink } from "@/components/ui/contact-link";
import { WaitingBadge } from "@/components/ui/waiting-badge";
import { appendDictatedText } from "@/lib/dictation";
import { formatShortDate, formatShortDateTime } from "@/lib/date";
import { formatMoney } from "@/lib/money";
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
  channelLabel,
  directionLabel,
  type CommunicationLog,
  type Reminder,
} from "@/lib/communications";
import { CONNECTION_EVENTS, offlineFetch } from "@/lib/offline-queue";
import { EditButton } from "@/components/ui/icon-button";
import { registerReversibleCreate, scheduleDeferredAction, scheduleDeferredDelete } from "@/lib/undo-engine";
import { useUndoOverlay } from "@/hooks/useUndoOverlay";
import { waitingRowId } from "@/hooks/useLocalAdditions";
import { israelDateKey } from "@/lib/timezone";

// A call/reminder here can be about anything (delivery, an order, a question) —
// not only collection — so the user tags it with a topic.
const TOPICS = [
  { value: "general", label: "כללי" },
  { value: "collection", label: "גבייה" },
  { value: "sales", label: "מכירה" },
  { value: "service", label: "שירות" },
  { value: "delivery", label: "משלוח" },
];

// A small control's tap area reaches past its 28–32px box to ~40.
const TAP_EXTEND = "relative before:absolute before:-inset-1.5 before:content-['']";

// A "+" here is the soft one of every section on the customer page, the same
// size (its AddActionButton): 32px to look at, 40 to tap.
const ADD_CLASS = "relative h-8 gap-1 px-2.5 before:absolute before:-inset-1 before:content-['']";

/** What the panel shows: the call log, the reminders and what the customer owes. */
export type CollectionPanelData = {
  logs: CommunicationLog[];
  reminders: Reminder[];
  receivables: CustomerReceivable[];
};

/** A call or reminder saved with no connection — on screen at once, sent later. */
type WaitingLog = { id: string; channel: string; direction: string; content: string | null; created_at: string };
type WaitingReminder = { id: string; remind_at: string; content: string | null };

type Props = {
  customerId: string;
  customerName: string;
  customerPhone?: string | null;
  /**
   * Called after any successful change, so a parent can refresh what it shows.
   * "money" when the debt itself changed (a payment marked collected);
   * "activity" for the call log and reminders, which the panel shows itself.
   */
  onChanged?: (what: "money" | "activity") => void;
  /**
   * Start the log-call / add-reminder forms collapsed behind "+" buttons and
   * collapse them again after a save (used when the panel is embedded inline
   * on the customer page rather than opened in a dedicated dialog).
   */
  collapsibleForms?: boolean;
  /**
   * What the page already read for this customer (the customer page reads it
   * with everything else). The panel starts from it instead of fetching it —
   * and the receivables a second time — after the page has shown.
   */
  initialData?: CollectionPanelData | null;
  /** Open one of the forms (a new `key` each time) — the page's ⋮ and cards ask for them. */
  formRequest?: { form: "call" | "reminder"; key: number } | null;
  /** The open reminders' count as it changes — for a section header. */
  onOpenRemindersChange?: (count: number) => void;
  /**
   * Israel's today on the server that drew the page, when the panel is drawn
   * there too (initialData): its "באיחור" marks then say the same in both
   * renders; the device's own date takes over after.
   */
  today?: string;
};

// The date only matters at the first paint and after it; nothing to listen to.
const noSubscription = () => () => {};

export default function CollectionTrackingPanel({
  customerId,
  customerName,
  customerPhone,
  onChanged,
  collapsibleForms = false,
  initialData = null,
  formRequest = null,
  onOpenRemindersChange,
  today: serverToday,
}: Props) {
  const today = useSyncExternalStore(noSubscription, israelDateKey, () => serverToday ?? israelDateKey());
  const isOverdue = (remindAt: string) => remindAt.slice(0, 10) < today;
  const [showCallForm, setShowCallForm] = useState(!collapsibleForms);
  const [showReminderForm, setShowReminderForm] = useState(!collapsibleForms);
  const [logsRaw, setLogs] = useState<CommunicationLog[]>(initialData?.logs ?? []);
  const logs = useUndoOverlay(logsRaw, (l) => l.id, "communication");
  const [remindersRaw, setReminders] = useState<Reminder[]>(initialData?.reminders ?? []);
  const reminders = useUndoOverlay(remindersRaw, (r) => r.id, "reminder");
  const [receivables, setReceivables] = useState<CustomerReceivable[]>(initialData?.receivables ?? []);
  const [waitingLogs, setWaitingLogs] = useState<WaitingLog[]>([]);
  const [waitingReminders, setWaitingReminders] = useState<WaitingReminder[]>([]);
  // Until the first answer there is nothing to say "no reminders" about.
  const [loaded, setLoaded] = useState(initialData !== null);
  const [error, setError] = useState<string | null>(null);

  // A newer reading from the page (it was read again after an edit) replaces
  // what the panel holds — the same answer the panel's own fetch would give.
  const [seed, setSeed] = useState(initialData);
  if (initialData && initialData !== seed) {
    setSeed(initialData);
    setLogs(initialData.logs);
    setReminders(initialData.reminders);
    setReceivables(initialData.receivables);
    setLoaded(true);
  }

  const { currentUserId } = useAssignableUsers();

  // Log-call form
  const [channel, setChannel] = useState("phone");
  const [direction, setDirection] = useState("outgoing");
  const [topic, setTopic] = useState("general");
  const [reminderTopic, setReminderTopic] = useState("general");
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

  const callFormRef = useRef<HTMLDivElement>(null);
  const reminderFormRef = useRef<HTMLDivElement>(null);
  const [scrollTo, setScrollTo] = useState<"call" | "reminder" | null>(null);

  // Default both assignee pickers to the current user once the list resolves.
  useEffect(() => {
    if (!currentUserId) return;
    setFollowUpAssignee((prev) => prev || currentUserId);
    setReminderAssignee((prev) => prev || currentUserId);
  }, [currentUserId]);

  /** The receivables only change when a payment does — a call or a reminder leaves them be. */
  const load = useCallback(
    async ({ receivables: withReceivables = true }: { receivables?: boolean } = {}) => {
      setError(null);
      try {
        const res = await fetch(
          `/api/collections/activity?customer_id=${encodeURIComponent(customerId)}${withReceivables ? "" : "&receivables=0"}`
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
        if (withReceivables) setReceivables(json.receivables ?? []);
      } catch (err) {
        setError(toHebrewError(err, "שגיאה לא ידועה"));
      } finally {
        setLoaded(true);
      }
    },
    [customerId]
  );

  // Fetched only when nobody handed the panel its data (the dialog that opens it from a list).
  const fetchOnMount = initialData === null;
  useEffect(() => {
    if (fetchOnMount) void load();
  }, [load, fetchOnMount]);

  // What waited for the connection has gone out: read the real rows instead.
  const waitingCount = waitingLogs.length + waitingReminders.length;
  useEffect(() => {
    if (waitingCount === 0) return;
    const onSynced = () => {
      void load({ receivables: false }).then(() => {
        setWaitingLogs([]);
        setWaitingReminders([]);
      });
    };
    window.addEventListener(CONNECTION_EVENTS.synced, onSynced);
    return () => window.removeEventListener(CONNECTION_EVENTS.synced, onSynced);
  }, [waitingCount, load]);

  // The page's ⋮ / card asked for a form: open it and bring it into view.
  useEffect(() => {
    if (!formRequest) return;
    if (formRequest.form === "call") setShowCallForm(true);
    else setShowReminderForm(true);
    setScrollTo(formRequest.form);
  }, [formRequest]);
  useEffect(() => {
    if (!scrollTo) return;
    const target = scrollTo === "call" ? callFormRef.current : reminderFormRef.current;
    if (!target) return;
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    target.querySelector<HTMLElement>("textarea, input")?.focus({ preventScroll: true });
    setScrollTo(null);
  }, [scrollTo, showCallForm, showReminderForm]);

  const openReminders = reminders.filter((r) => r.status === "pending");
  const openCount = openReminders.length + waitingReminders.length;
  useEffect(() => {
    onOpenRemindersChange?.(openCount);
  }, [openCount, onOpenRemindersChange]);

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
      const followUpAt = withFollowUp ? new Date(followUpDate).toISOString() : null;
      const result = await offlineFetch(
        "/api/communications/create",
        {
          customer_id: customerId,
          channel,
          direction,
          category: topic,
          content: content.trim() || undefined,
          follow_up: followUpAt
            ? {
                remind_at: followUpAt,
                content: followUpContent.trim() || undefined,
                assigned_to: followUpAssignee || undefined,
              }
            : undefined,
        },
        "תיעוד שיחה",
        { idempotent: true }
      );
      if (result.queued) {
        // Saved on the device: on the page now, marked as waiting.
        setWaitingLogs((prev) => [
          { id: waitingRowId(), channel, direction, content: content.trim() || null, created_at: new Date().toISOString() },
          ...prev,
        ]);
        if (followUpAt) {
          setWaitingReminders((prev) => [
            { id: waitingRowId(), remind_at: followUpAt, content: followUpContent.trim() || null },
            ...prev,
          ]);
        }
        resetCallForm();
        onChanged?.("activity");
        return;
      }
      if (!result.ok) {
        setError(toHebrewError(result.error, "שמירה נכשלה"));
        return;
      }
      resetCallForm();
      await load({ receivables: false });
      onChanged?.("activity");
      const data = result.data as { id?: string | null; reminder_id?: string | null } | null;
      const newId = data?.id;
      const message = followUpAt ? "השיחה תועדה ותזכורת המשך נקבעה" : "השיחה תועדה";
      if (!newId) {
        toast.success(message);
      } else {
        const followUpId = data?.reminder_id;
        registerReversibleCreate({
          scope: "communication",
          id: newId,
          message,
          onUndo: async () => {
            const res = await fetch("/api/communications/delete", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: newId }),
            });
            const json = await res.json().catch(() => ({}));
            if (followUpId) {
              await fetch("/api/reminders/update", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: followUpId, status: "cancelled" }),
              });
            }
            await load({ receivables: false });
            if (!res.ok) return { ok: false, error: toHebrewError(json?.error, "ביטול נכשל.") };
            return { ok: true };
          },
        });
      }
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
      const remindAt = new Date(reminderDate).toISOString();
      const result = await offlineFetch(
        "/api/reminders/create",
        {
          customer_id: customerId,
          remind_at: remindAt,
          content: reminderNote.trim() || undefined,
          action_type: "other",
          category: reminderTopic,
          assigned_to: reminderAssignee || undefined,
        },
        "תזכורת חדשה",
        { idempotent: true }
      );
      if (result.queued) {
        setWaitingReminders((prev) => [{ id: waitingRowId(), remind_at: remindAt, content: reminderNote.trim() || null }, ...prev]);
        resetReminderForm();
        onChanged?.("activity");
        return;
      }
      if (!result.ok) {
        setError(toHebrewError(result.error, "שמירת התזכורת נכשלה"));
        return;
      }
      resetReminderForm();
      await load({ receivables: false });
      onChanged?.("activity");
      const newId = (result.data as { id?: string | null } | null)?.id;
      if (!newId) {
        toast.success("התזכורת נוספה");
      } else {
        registerReversibleCreate({
          scope: "reminder",
          id: newId,
          message: "התזכורת נוספה",
          onUndo: async () => {
            const res = await fetch("/api/reminders/update", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: newId, status: "cancelled" }),
            });
            const json = await res.json().catch(() => ({}));
            await load({ receivables: false });
            if (!res.ok) return { ok: false, error: toHebrewError(json?.error, "ביטול נכשל.") };
            return { ok: true };
          },
        });
      }
    } finally {
      setSubmitting(false);
    }
  }

  function updateReminder(id: string, status: "done" | "cancelled") {
    scheduleDeferredDelete({
      scope: "reminder",
      id,
      message: status === "done" ? "התזכורת סומנה כבוצעה" : "התזכורת בוטלה",
      onCommit: async () => {
        const result = await offlineFetch(
          "/api/reminders/update",
          { id, status },
          status === "done" ? "סימון תזכורת כבוצעה" : "ביטול תזכורת"
        );
        if (!result.queued && !result.ok) {
          return { ok: false, error: toHebrewError(result.error, "עדכון התזכורת נכשל.") };
        }
        await load({ receivables: false });
        onChanged?.("activity");
        return { ok: true };
      },
    });
  }

  // A pending payment (an uncleared check, a future-dated transfer) isn't a new
  // payment — the row already exists, the money just landed. Flip it to cleared.
  function markCollected(paymentId: string) {
    const snapshot = receivables;
    scheduleDeferredAction({
      key: `payment-collected:${paymentId}`,
      message: "התשלום סומן כנגבה",
      onApplyOptimistic: () => {
        setReceivables((prev) =>
          prev.map((r) => ({ ...r, pending_payments: r.pending_payments.filter((p) => p.id !== paymentId) }))
        );
      },
      onRevert: () => setReceivables(snapshot),
      onCommit: async () => {
        const result = await offlineFetch(
          "/api/payments/mark-collected",
          { id: paymentId, collected: true },
          "סימון תשלום כנגבה"
        );
        if (!result.queued && !result.ok) {
          return { ok: false, error: toHebrewError(result.error, "סימון התשלום נכשל.") };
        }
        await load();
        onChanged?.("money");
        return { ok: true };
      },
    });
  }

  const totalOutstanding = receivables.reduce((sum, r) => sum + r.outstanding_amount, 0);

  // The two entry forms — placed near the top in dialog mode, near the footer
  // action bar in the inline (collapsible) mode so they open where the buttons are.
  const callFormBlock = showCallForm ? (
    <div ref={callFormRef} className="scroll-mt-24 rounded-xl border border-border/70 bg-background/60 p-3">
      <div className="mb-2 text-sm font-semibold">תיעוד שיחה</div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <NativeSelect value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="ערוץ">
          {COMMUNICATION_CHANNELS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect value={direction} onChange={(e) => setDirection(e.target.value)} aria-label="כיוון">
          <option value="outgoing">שיחה יוצאת</option>
          <option value="incoming">שיחה נכנסת</option>
          <option value="missed">שלא נענתה</option>
        </NativeSelect>
        <NativeSelect value={topic} onChange={(e) => setTopic(e.target.value)} title="נושא" aria-label="נושא">
          {TOPICS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="relative">
        <Textarea
          className="mt-2 pe-11"
          rows={2}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="מה סוכם? מה הלקוח אמר?"
          aria-label="תוכן השיחה"
        />
        <DictateButton
          onTranscript={(text) => setContent((prev) => appendDictatedText(prev, text))}
          disabled={submitting}
          className="absolute bottom-1 end-1 h-8 w-8"
        />
      </div>

      <label className="mt-2 flex min-h-10 items-center gap-2 text-sm">
        <input type="checkbox" checked={withFollowUp} onChange={(e) => setWithFollowUp(e.target.checked)} />
        קבע תזכורת המשך
      </label>
      {withFollowUp ? (
        <div className="mt-2 space-y-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <DateTimeInput value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} />
            <Input
              value={followUpContent}
              onChange={(e) => setFollowUpContent(e.target.value)}
              placeholder="להתקשר שוב..."
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
          <Button type="button" size="sm" variant="muted" onClick={() => setShowCallForm(false)} disabled={submitting}>
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
    <div ref={reminderFormRef} className="scroll-mt-24 rounded-xl border border-border/70 bg-background/60 p-3">
      <div className="mb-2 text-sm font-semibold">קביעת תזכורת</div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <DateTimeInput value={reminderDate} onChange={(e) => setReminderDate(e.target.value)} />
        <NativeSelect value={reminderTopic} onChange={(e) => setReminderTopic(e.target.value)} title="נושא" aria-label="נושא">
          {TOPICS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <Input
        value={reminderNote}
        onChange={(e) => setReminderNote(e.target.value)}
        placeholder="על מה להזכיר? (אופציונלי)"
        className="mt-2"
      />
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
            variant="muted"
            onClick={() => setShowReminderForm(false)}
            disabled={submitting}
          >
            סגירה
          </Button>
        ) : null}
        <Button type="button" size="sm" onClick={() => void addReminder()} disabled={submitting}>
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
              <ContactLink kind="tel" value={customerPhone} className="hover:underline">
                <PhoneIcon className="inline h-3 w-3 align-text-bottom" /> <span dir="ltr">{customerPhone}</span>
              </ContactLink>
            </>
          ) : null}
        </div>
      ) : null}

      {/* What the customer owes — collected vs expected, with mark-collected */}
      {receivables.length > 0 ? (
        <div className="rounded-xl border border-border/70 bg-background/60 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold">מה חייב</span>
            <span className="text-sm font-semibold tabular-nums text-destructive">{formatMoney(totalOutstanding)}</span>
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
                <div key={r.collection_key} className="rounded-lg border border-border/60 bg-background/50 p-2 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="min-w-0 font-medium">
                        {r.source_type === "loan" ? (r.title ? `הלוואה — ${r.title}` : "הלוואה") : r.title ?? fallbackTitle}
                      </span>
                      <Badge className={collectionStatusClasses(r.collection_status)}>
                        {collectionStatusLabel(r.collection_status)}
                      </Badge>
                    </div>
                    <span className="font-semibold tabular-nums">{formatMoney(r.outstanding_amount)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                    <span>תאריך: {formatShortDate(r.reference_date, "—")}</span>
                    {r.payment_terms ? <span>צורת תשלום: {paymentTermsLabel(r.payment_terms)}</span> : null}
                    {r.due_date || r.next_due_date ? (
                      <span>פירעון: {formatShortDate(r.due_date ?? r.next_due_date, "—")}</span>
                    ) : null}
                    {r.days_late > 0 ? <span className="text-destructive">{r.days_late} ימים באיחור</span> : null}
                  </div>
                  {r.source_type === "loan" ? (
                    <div className="mt-2 flex justify-end border-t border-border/50 pt-2">
                      <Button asChild size="sm" variant="outline" className={`h-8 text-xs ${TAP_EXTEND}`}>
                        <Link href={`/financial/loans/${r.source_id}`}>רישום החזר</Link>
                      </Button>
                    </div>
                  ) : null}
                  {r.pending_payments.length > 0 ? (
                    <div className="mt-2 space-y-1 border-t border-border/50 pt-2">
                      {r.pending_payments.map((p) => (
                        <div key={p.id} className="flex items-center justify-between gap-2">
                          <span className={p.overdue ? "text-destructive" : "text-muted-foreground"}>
                            {formatMoney(p.amount)} · פירעון {formatShortDate(p.due_date, "—")}
                            {p.payment_method ? ` · ${paymentMethodLabel(p.payment_method)}` : ""}
                            {p.overdue ? " (באיחור)" : ""}
                          </span>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className={`h-8 shrink-0 text-xs ${TAP_EXTEND}`}
                            onClick={() => markCollected(p.id)}
                          >
                            סמן כנגבה
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
          תזכורות פתוחות{loaded ? ` (${openCount})` : ""}
        </div>
        {!loaded ? (
          // Not "no reminders" while they're still on their way.
          <p className="text-sm text-muted-foreground">טוען...</p>
        ) : openCount === 0 ? (
          <p className="text-sm text-muted-foreground">אין תזכורות פתוחות.</p>
        ) : (
          <div className="space-y-2">
            {waitingReminders.map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-border/70 bg-background/60 p-3 text-sm"
              >
                <div className="flex min-w-0 items-start gap-2.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-warning-soft text-warning-soft-foreground">
                    <ReminderIcon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="font-semibold">{r.content || "תזכורת"}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">מתוזמן ל-{formatShortDateTime(r.remind_at, "—")}</div>
                  </div>
                </div>
                <WaitingBadge />
              </div>
            ))}
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
                        overdue ? "bg-destructive-soft text-destructive" : "bg-warning-soft text-warning-soft-foreground"
                      }`}
                    >
                      <ReminderIcon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="font-semibold">{r.content || actionTypeLabel(r.action_type)}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {actionTypeLabel(r.action_type)} · מתוזמן ל-{formatShortDateTime(r.remind_at, "—")}
                        {overdue ? <span className="text-destructive"> (באיחור)</span> : null}
                        {r.assigned_to_name ? ` · ${r.assigned_to_name}` : ""}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-9 px-3 text-xs"
                      title="סימון כבוצע"
                      onClick={() => updateReminder(r.id, "done")}
                    >
                      <CheckIcon className="h-3.5 w-3.5" />
                      בוצע
                    </Button>
                    <EditButton onClick={() => setEditingReminder(r)} label="עריכת תזכורת" />
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="muted"
                      title="ביטול תזכורת"
                      aria-label="ביטול תזכורת"
                      onClick={() => updateReminder(r.id, "cancelled")}
                    >
                      <CloseIcon className="h-3.5 w-3.5" />
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
        {!loaded ? (
          <p className="text-sm text-muted-foreground">טוען...</p>
        ) : logs.length === 0 && waitingLogs.length === 0 ? (
          <p className="text-sm text-muted-foreground">עדיין לא תועדו שיחות.</p>
        ) : (
          <div className="space-y-2">
            {waitingLogs.map((log) => (
              <div key={log.id} className="rounded-xl border border-border/70 bg-background/60 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {channelLabel(log.channel)}
                    {log.channel === "phone" ? ` · ${directionLabel(log.direction)}` : ""}
                  </span>
                  <WaitingBadge />
                </div>
                {log.content ? <div className="mt-1 whitespace-pre-wrap">{log.content}</div> : null}
                <div className="mt-1 text-xs text-muted-foreground">{formatShortDateTime(log.created_at, "—")}</div>
              </div>
            ))}
            {logs.map((log) => (
              <CommunicationLogItem
                key={log.id}
                log={log}
                onChanged={() => {
                  void load({ receivables: false });
                  onChanged?.("activity");
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
          {/* The less important action's look (soft), as every section's "+". */}
          {!showReminderForm ? (
            <Button
              type="button"
              size="sm"
              variant="soft"
              className={ADD_CLASS}
              onClick={() => setShowReminderForm(true)}
            >
              <AddIcon aria-hidden />
              תזכורת
            </Button>
          ) : null}
          {!showCallForm ? (
            <Button
              type="button"
              size="sm"
              variant="soft"
              className={ADD_CLASS}
              onClick={() => setShowCallForm(true)}
            >
              <AddIcon aria-hidden />
              תיעוד שיחה
            </Button>
          ) : null}
        </div>
      ) : null}

      {editingReminder ? (
        <EditReminderDialog
          key={editingReminder.id}
          reminder={editingReminder}
          onClose={() => setEditingReminder(null)}
          onSaved={() => {
            void load({ receivables: false });
            onChanged?.("activity");
          }}
        />
      ) : null}
    </div>
  );
}

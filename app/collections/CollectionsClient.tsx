"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, MessageCircle, Phone } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatShortDate } from "@/lib/date";
import { getBusinessDomainLabel } from "@/lib/expenses";
import { collectionStatusClasses, collectionStatusLabel, paymentMethodLabel } from "@/lib/orders/paymentStatus";
import { paymentTermsLabel } from "@/lib/paymentTerms";
import {
  actionTypeLabel,
  type CommunicationLogWithCustomer,
  type Reminder,
} from "@/lib/communications";
import CustomerCollectionButton from "@/components/collections/CustomerCollectionButton";
import CommunicationLogItem from "@/components/collections/CommunicationLogItem";
import BulkActions from "@/components/collections/BulkActions";
import type { CollectionCustomerGroup, PaymentDueToday } from "@/lib/collections";

type Props = {
  customers: CollectionCustomerGroup[];
  totals: { outstanding: number; pending: number; overdue: number; customerCount: number };
  reminders: Reminder[];
  recentLogs: CommunicationLogWithCustomer[];
  dueToday: PaymentDueToday[];
};

type View = "debtors" | "reminders" | "activity";
type FilterKey = "all" | "overdue" | "due_soon" | "uncontacted";
type SortKey = "amount" | "oldest" | "name" | "due";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDate(value: string | null) {
  return value ? formatShortDate(value) : "—";
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function isDueSoon(dateIso: string | null) {
  if (!dateIso) return false;
  const due = new Date(dateIso);
  if (Number.isNaN(due.getTime())) return false;
  const in14 = new Date();
  in14.setDate(in14.getDate() + 14);
  return due <= in14;
}

/** Build a wa.me link from an Israeli phone/whatsapp number with a prefilled message. */
function whatsappLink(number: string | null, message: string): string | null {
  if (!number) return null;
  let digits = number.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("0")) digits = `972${digits.slice(1)}`;
  else if (!digits.startsWith("972")) digits = `972${digits}`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

function daysSince(dateIso: string | null): number | null {
  if (!dateIso) return null;
  const d = new Date(dateIso);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.max(Math.floor((now.getTime() - d.getTime()) / 86_400_000), 0);
}

// "Who haven't I chased" signal. The never-contacted warning shows only when the
// customer actually has overdue debt (no point flagging a not-yet-due customer).
function LastContactSignal({ lastContactAt, overdue }: { lastContactAt: string | null; overdue: boolean }) {
  if (!lastContactAt) {
    if (!overdue) return <span className="text-muted-foreground/40">—</span>;
    return <span className="text-[11px] font-medium text-warning-strong">⚠ טרם נוצר קשר</span>;
  }
  const days = daysSince(lastContactAt);
  const label = days === 0 ? "היום" : formatDate(lastContactAt);
  const stale = (days ?? 0) >= 7;
  return (
    <span className={`text-xs ${stale ? "text-warning-strong" : "text-muted-foreground"}`}>{label}</span>
  );
}

function SummaryCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "danger" | "warning";
}) {
  const toneClass =
    tone === "danger"
      ? "text-destructive"
      : tone === "warning"
        ? "text-warning-strong"
        : "text-foreground";
  return (
    <div className="rounded-2xl border border-border/70 bg-background/80 px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}

export default function CollectionsClient({
  customers,
  totals,
  reminders: remindersProp,
  recentLogs,
  dueToday,
}: Props) {
  const router = useRouter();
  // Reminders marked done/cancelled are hidden immediately so the action is
  // visible even before router.refresh() re-fetches (and regardless of caching).
  const [completedReminderIds, setCompletedReminderIds] = useState<Set<string>>(() => new Set());
  const reminders = useMemo(
    () => remindersProp.filter((r) => !completedReminderIds.has(r.id)),
    [remindersProp, completedReminderIds]
  );
  const [view, setView] = useState<View>("activity");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [search, setSearch] = useState("");
  const [domain, setDomain] = useState("all");
  const [sort, setSort] = useState<SortKey>("amount");
  const [collectingId, setCollectingId] = useState<string | null>(null);
  const [focusReminderCustomer, setFocusReminderCustomer] = useState<string | null>(null);

  // Jump from a debtor row to that customer's reminder in the תזכורות tab.
  function openReminders(customerId: string | null) {
    setFocusReminderCustomer(customerId);
    setView("reminders");
  }

  const domainOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const group of customers) {
      for (const source of group.sources) {
        const key = source.business_domain ?? "";
        if (key && !seen.has(key)) seen.set(key, getBusinessDomainLabel(source.business_domain));
      }
    }
    return Array.from(seen, ([value, label]) => ({ value, label }));
  }, [customers]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = customers.filter((c) => {
      if (filter === "overdue" && !(c.overdue_amount > 0.009)) return false;
      if (filter === "due_soon" && !(isDueSoon(c.next_due_date) || c.overdue_amount > 0.009)) {
        return false;
      }
      if (filter === "uncontacted" && c.last_contact_at) return false;
      if (domain !== "all" && !c.sources.some((s) => s.business_domain === domain)) return false;
      if (q) {
        const haystack = `${c.customer_name} ${c.customer_phone ?? ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
    const sorted = [...list];
    switch (sort) {
      case "oldest":
        sorted.sort(
          (a, b) => b.oldest_days_late - a.oldest_days_late || b.outstanding_amount - a.outstanding_amount
        );
        break;
      case "name":
        sorted.sort((a, b) => a.customer_name.localeCompare(b.customer_name, "he"));
        break;
      case "due":
        sorted.sort((a, b) => (a.next_due_date ?? "9999").localeCompare(b.next_due_date ?? "9999"));
        break;
      default:
        sorted.sort((a, b) => b.outstanding_amount - a.outstanding_amount);
    }
    return sorted;
  }, [customers, filter, search, domain, sort]);

  const overdueReminderCount = reminders.filter((r) => r.remind_at.slice(0, 10) < todayIso()).length;

  async function updateReminder(id: string, status: "done" | "cancelled") {
    try {
      const res = await fetch("/api/reminders/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(json.error ?? "עדכון התזכורת נכשל.");
        return;
      }
      setCompletedReminderIds((prev) => new Set(prev).add(id));
      toast.success(status === "done" ? "התזכורת סומנה כבוצעה." : "התזכורת בוטלה.");
      router.refresh();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "עדכון התזכורת נכשל.");
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
      if (res.ok) router.refresh();
    } finally {
      setCollectingId(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* להיום — what needs attention today: reminders due + payments to collect now */}
      <TodayOverview
        reminders={reminders}
        dueToday={dueToday}
        collectingId={collectingId}
        onCollect={markCollected}
        onUpdateReminder={updateReminder}
      />

      {/* View switch — call history first, then reminders, then debtors */}
      <div className="flex flex-wrap gap-2 border-b border-border/60 pb-2">
        <Button
          type="button"
          size="sm"
          variant={view === "activity" ? "default" : "ghost"}
          onClick={() => setView("activity")}
        >
          יומן שיחות
        </Button>
        <Button
          type="button"
          size="sm"
          variant={view === "reminders" ? "default" : "ghost"}
          onClick={() => setView("reminders")}
        >
          תזכורות{reminders.length ? ` (${reminders.length})` : ""}
          {overdueReminderCount ? (
            <span className="ms-1 rounded-full bg-destructive px-1.5 text-[10px] text-destructive-foreground">
              {overdueReminderCount}
            </span>
          ) : null}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={view === "debtors" ? "default" : "ghost"}
          onClick={() => setView("debtors")}
        >
          חייבים{totals.customerCount ? ` (${totals.customerCount})` : ""}
        </Button>
      </div>

      {view === "activity" ? (
        <ActivityView logs={recentLogs} onChanged={() => router.refresh()} />
      ) : view === "reminders" ? (
        <RemindersView
          reminders={reminders}
          onUpdate={updateReminder}
          focusCustomerId={focusReminderCustomer}
        />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard label="סה״כ לגבייה" value={formatCurrency(totals.outstanding)} />
            <SummaryCard label="באיחור" value={formatCurrency(totals.overdue)} tone="danger" />
            <SummaryCard label="צפוי (טרם נגבה)" value={formatCurrency(totals.pending)} tone="warning" />
            <SummaryCard label="לקוחות חייבים" value={`${totals.customerCount}`} />
          </div>
          <DebtorsTable
            filter={filter}
            setFilter={setFilter}
            search={search}
            setSearch={setSearch}
            domain={domain}
            setDomain={setDomain}
            domainOptions={domainOptions}
            sort={sort}
            setSort={setSort}
            filtered={filtered}
            onOpenReminders={openReminders}
          />
        </div>
      )}
    </div>
  );
}

// "להיום" — the landing digest: reminders due today/overdue + payments to collect
// today. Renders nothing on a clear day so the call log (default tab) leads.
function TodayOverview({
  reminders,
  dueToday,
  collectingId,
  onCollect,
  onUpdateReminder,
}: {
  reminders: Reminder[];
  dueToday: PaymentDueToday[];
  collectingId: string | null;
  onCollect: (paymentId: string) => void;
  onUpdateReminder: (id: string, status: "done" | "cancelled") => void;
}) {
  const today = todayIso();
  const dueReminders = reminders.filter((r) => r.remind_at.slice(0, 10) <= today);
  if (dueReminders.length === 0 && dueToday.length === 0) return null;

  return (
    <div className="space-y-3">
      {dueReminders.length > 0 ? (
        <div className="rounded-2xl border border-warning/40 bg-warning/5 p-4">
          <div className="mb-2 text-sm font-semibold">תזכורות להיום ({dueReminders.length})</div>
          <div className="space-y-2">
            {dueReminders.map((r) => {
              const overdue = r.remind_at.slice(0, 10) < today;
              return (
                <div
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-background/60 p-2 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    {r.customer_id ? (
                      <NavLink to={`/customers/${r.customer_id}`} className="font-medium hover:underline">
                        {r.customer_name ?? "לקוח"}
                      </NavLink>
                    ) : (
                      <span className="font-medium">{r.customer_name ?? "כללי"}</span>
                    )}
                    {r.customer_phone ? (
                      <a href={`tel:${r.customer_phone}`} className="text-muted-foreground hover:underline">
                        ☎ {r.customer_phone}
                      </a>
                    ) : null}
                    <span className="text-muted-foreground">{actionTypeLabel(r.action_type)}</span>
                    {r.content ? <span className="text-muted-foreground">· {r.content}</span> : null}
                    <span className={overdue ? "font-medium text-destructive" : "text-muted-foreground"}>
                      {overdue ? "באיחור · " : ""}
                      {formatShortDate(r.remind_at)}
                    </span>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    onClick={() => onUpdateReminder(r.id, "done")}
                  >
                    בוצע
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
      {dueToday.length > 0 ? (
        <DueTodaySection dueToday={dueToday} collectingId={collectingId} onCollect={onCollect} />
      ) : null}
    </div>
  );
}

function DueTodaySection({
  dueToday,
  collectingId,
  onCollect,
}: {
  dueToday: PaymentDueToday[];
  collectingId: string | null;
  onCollect: (paymentId: string) => void;
}) {
  const total = dueToday.reduce((sum, p) => sum + p.amount, 0);
  return (
    <div className="rounded-2xl border border-warning/40 bg-warning/5 p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">תשלומים לפירעון היום ({dueToday.length})</span>
        <span className="text-sm font-semibold">{formatCurrency(total)}</span>
      </div>
      <div className="space-y-2">
        {dueToday.map((p) => {
          const href =
            p.source_type === "order"
              ? `/sales/orders/${p.source_id}`
              : p.source_type === "project"
                ? `/projects/${p.source_id}`
                : null;
          return (
            <div
              key={p.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-background/60 p-2 text-sm"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {p.customer_id ? (
                  <NavLink to={`/customers/${p.customer_id}`} className="font-medium hover:underline">
                    {p.customer_name}
                  </NavLink>
                ) : (
                  <span className="font-medium">{p.customer_name}</span>
                )}
                {p.customer_phone ? (
                  <a href={`tel:${p.customer_phone}`} className="text-muted-foreground hover:underline">
                    ☎ {p.customer_phone}
                  </a>
                ) : null}
                {href ? (
                  <NavLink to={href} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                    {p.source_type === "order" ? "הזמנה" : "פרויקט"}
                  </NavLink>
                ) : null}
                {p.payment_method === "check" ? (
                  <span className="text-muted-foreground">
                    צ׳ק{p.check_number ? ` מס׳ ${p.check_number}` : ""} — להפקדה
                  </span>
                ) : p.payment_method ? (
                  <span className="text-muted-foreground">{paymentMethodLabel(p.payment_method)}</span>
                ) : null}
              </div>
              <div className="flex items-center gap-3">
                <span className="font-semibold">{formatCurrency(p.amount)}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  disabled={collectingId === p.id}
                  onClick={() => onCollect(p.id)}
                >
                  {collectingId === p.id ? "מסמן..." : "סמן כנגבה"}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Aging buckets by DAYS LATE. "שוטף" is avoided as a header because in Israeli
// business it means a payment TERM (end-of-month, שוטף+30/+40), not "not late".
const AGING_COLUMNS: {
  key: keyof CollectionCustomerGroup["aging"];
  label: string;
  tone: "muted" | "warning" | "danger";
  hint: string;
}[] = [
  { key: "current", label: "צפוי", tone: "muted", hint: "טרם הגיע מועד התשלום — תשלום עתידי מתוזמן" },
  { key: "d30", label: "1–30 ימים", tone: "muted", hint: "באיחור 1–30 ימים" },
  { key: "d60", label: "31–60 ימים", tone: "warning", hint: "באיחור 31–60 ימים" },
  { key: "d90", label: "61–90 ימים", tone: "warning", hint: "באיחור 61–90 ימים" },
  { key: "d90plus", label: "90+ ימים", tone: "danger", hint: "באיחור מעל 90 ימים" },
];

function AgingValue({ value, tone }: { value: number; tone: "muted" | "warning" | "danger" }) {
  if (value <= 0.009) return <span className="text-muted-foreground/40">—</span>;
  const cls =
    tone === "danger"
      ? "font-semibold text-destructive"
      : tone === "warning"
        ? "font-medium text-warning-strong"
        : "";
  return <span className={cls}>{formatCurrency(value)}</span>;
}

// Subtle row/card tint by worst aging bucket, so the riskiest debts stand out.
function severityTint(group: CollectionCustomerGroup): string {
  if (group.aging.d90plus > 0.009) return "bg-destructive/5";
  if (group.aging.d90 > 0.009 || group.aging.d60 > 0.009) return "bg-warning/5";
  return "";
}

function buildWaMessage(group: CollectionCustomerGroup): string {
  return `שלום, נותרה יתרה לתשלום בסך ${formatCurrency(group.outstanding_amount)}. נשמח להסדרת התשלום. תודה!`;
}

// One-tap "collect" for a source's pending (future-dated / uncleared) payments.
function MarkCollectedButton({ paymentIds }: { paymentIds: string[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function run() {
    if (busy || paymentIds.length === 0) return;
    setBusy(true);
    try {
      await Promise.all(
        paymentIds.map((id) =>
          fetch("/api/payments/mark-collected", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id, collected: true }),
          })
        )
      );
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="h-7 text-xs"
      disabled={busy}
      onClick={() => void run()}
    >
      {busy ? "מסמן..." : "סמן כנגבה"}
    </Button>
  );
}

function CustomerActions({
  group,
  wa,
  withCall = false,
}: {
  group: CollectionCustomerGroup;
  wa: string | null;
  withCall?: boolean;
}) {
  return (
    <div className="flex items-center gap-1">
      {withCall && group.customer_phone ? (
        <a
          href={`tel:${group.customer_phone}`}
          title="התקשרות"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-input hover:bg-muted"
        >
          <Phone className="h-4 w-4" />
        </a>
      ) : null}
      {wa ? (
        <a
          href={wa}
          target="_blank"
          rel="noreferrer"
          title="שליחת תזכורת בוואטסאפ"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-input hover:bg-muted"
        >
          <MessageCircle className="h-4 w-4 text-success" />
        </a>
      ) : null}
      {group.customer_id ? (
        <CustomerCollectionButton
          customerId={group.customer_id}
          customerName={group.customer_name}
          customerPhone={group.customer_phone}
          label="מעקב"
          refreshOnClose
        />
      ) : null}
    </div>
  );
}

// One open debt (order/project) — shared by the desktop expanded row and the
// mobile card. Offers inline "סמן כנגבה" when the debt has pending payments.
function SourceDetail({ source }: { source: CollectionCustomerGroup["sources"][number] }) {
  const isOrder = source.source_type === "order";
  const href = isOrder ? `/sales/orders/${source.source_id}` : `/projects/${source.source_id}`;
  const linkText = isOrder
    ? `הזמנה #${source.source_id.slice(0, 8)}`
    : source.title ?? `פרויקט #${source.source_id.slice(0, 8)}`;
  const pendingIds = source.pending_payments.map((p) => p.id);
  const methods = Array.from(
    new Set(source.pending_payments.filter((p) => p.payment_method).map((p) => paymentMethodLabel(p.payment_method)))
  );
  return (
    <div className="rounded-lg border border-border/50 bg-background/60 p-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <NavLink
          to={href}
          target="_blank"
          rel="noreferrer"
          className="text-sm font-medium text-primary hover:underline"
        >
          {linkText}
        </NavLink>
        <Badge className={collectionStatusClasses(source.collection_status)}>
          {collectionStatusLabel(source.collection_status)}
        </Badge>
        <span className="text-muted-foreground">תאריך: {formatDate(source.reference_date)}</span>
        <span className="font-semibold text-foreground">{formatCurrency(source.outstanding_amount)}</span>
        <span className="text-muted-foreground">צורת תשלום: {paymentTermsLabel(source.payment_terms)}</span>
        {source.due_date || source.next_due_date ? (
          <span className="text-muted-foreground">פירעון: {formatDate(source.due_date ?? source.next_due_date)}</span>
        ) : null}
        {methods.length > 0 ? (
          <span className="text-muted-foreground">אמצעי: {methods.join(", ")}</span>
        ) : null}
        {source.days_late > 0 ? (
          <span className="font-medium text-destructive">{source.days_late} ימים באיחור</span>
        ) : null}
        {pendingIds.length > 0 ? (
          <span className="ms-auto">
            <MarkCollectedButton paymentIds={pendingIds} />
          </span>
        ) : null}
      </div>
      {isOrder && source.items.length > 0 ? (
        <div className="mt-1 text-xs text-muted-foreground">{source.items.join(" · ")}</div>
      ) : null}
    </div>
  );
}

function CustomerCard({
  group,
  isOpen,
  onToggle,
  wa,
  selected,
  onToggleSelect,
  onOpenReminders,
}: {
  group: CollectionCustomerGroup;
  isOpen: boolean;
  onToggle: () => void;
  wa: string | null;
  selected: boolean;
  onToggleSelect?: () => void;
  onOpenReminders: (customerId: string | null) => void;
}) {
  const tint = severityTint(group);
  return (
    <div className={`rounded-2xl border border-border/70 p-3 ${tint}`}>
      <div className="flex items-start gap-2">
        {onToggleSelect ? (
          <input
            type="checkbox"
            aria-label="בחירת לקוח"
            checked={selected}
            onChange={onToggleSelect}
            className="mt-1 h-4 w-4 shrink-0"
          />
        ) : null}
        <button type="button" onClick={onToggle} className="flex w-full items-start justify-between gap-2 text-right">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`}
              />
              <span className="font-semibold">{group.customer_name}</span>
              <Badge className={collectionStatusClasses(group.status)}>{collectionStatusLabel(group.status)}</Badge>
            </div>
            {group.customer_phone ? (
              <div className="mt-1 text-sm text-muted-foreground">☎ {group.customer_phone}</div>
            ) : null}
            {group.oldest_days_late > 0 ? (
              <div className="text-xs text-destructive">{group.oldest_days_late} ימים באיחור</div>
            ) : null}
            <div className="mt-0.5">
              <LastContactSignal
                lastContactAt={group.last_contact_at}
                overdue={group.overdue_amount > 0.009}
              />
            </div>
          </div>
          <div className="shrink-0 text-lg font-semibold">{formatCurrency(group.outstanding_amount)}</div>
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-border/50 pt-2">
        <CustomerActions group={group} wa={wa} withCall />
        {group.next_reminder_at ? (
          <button
            type="button"
            onClick={() => onOpenReminders(group.customer_id)}
            title="מעבר לתזכורת"
            className="ms-auto text-xs text-primary hover:underline"
          >
            🔔 תזכורת {formatDate(group.next_reminder_at)}
          </button>
        ) : null}
      </div>
      {isOpen ? (
        <div className="mt-2 space-y-2 border-t border-border/50 pt-2">
          {group.sources.map((source) => (
            <SourceDetail key={source.collection_key} source={source} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DebtorsTable({
  filter,
  setFilter,
  search,
  setSearch,
  domain,
  setDomain,
  domainOptions,
  sort,
  setSort,
  filtered,
  onOpenReminders,
}: {
  filter: FilterKey;
  setFilter: (f: FilterKey) => void;
  search: string;
  setSearch: (s: string) => void;
  domain: string;
  setDomain: (d: string) => void;
  domainOptions: { value: string; label: string }[];
  sort: SortKey;
  setSort: (s: SortKey) => void;
  filtered: CollectionCustomerGroup[];
  onOpenReminders: (customerId: string | null) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const tabs: { key: FilterKey; label: string }[] = [
    { key: "all", label: "הכל" },
    { key: "overdue", label: "באיחור" },
    { key: "due_soon", label: "לגבייה בקרוב" },
    { key: "uncontacted", label: "טרם נוצר קשר" },
  ];

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const selectableIds = filtered.map((g) => g.customer_id).filter((x): x is string => Boolean(x));
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleSelectAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (selectableIds.every((id) => prev.has(id))) selectableIds.forEach((id) => next.delete(id));
      else selectableIds.forEach((id) => next.add(id));
      return next;
    });
  }
  function clearSelection() {
    setSelected(new Set());
  }
  const selectedGroups = filtered.filter((g) => g.customer_id && selected.has(g.customer_id));

  const footer = filtered.reduce(
    (acc, c) => {
      acc.current += c.aging.current;
      acc.d30 += c.aging.d30;
      acc.d60 += c.aging.d60;
      acc.d90 += c.aging.d90;
      acc.d90plus += c.aging.d90plus;
      acc.outstanding += c.outstanding_amount;
      return acc;
    },
    { current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0, outstanding: 0 }
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {tabs.map((tab) => (
          <Button
            key={tab.key}
            type="button"
            size="sm"
            variant={filter === tab.key ? "default" : "outline"}
            onClick={() => setFilter(tab.key)}
          >
            {tab.label}
          </Button>
        ))}
        {domainOptions.length > 1 ? (
          <select
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="all">כל התחומים</option>
            {domainOptions.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        ) : null}
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="amount">מיון: סכום</option>
          <option value="oldest">מיון: ותק החוב</option>
          <option value="due">מיון: תאריך פירעון</option>
          <option value="name">מיון: שם</option>
        </select>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="חיפוש לפי שם או טלפון..."
          className="h-9 w-full sm:w-56"
        />
      </div>

      <div className="space-y-1">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {AGING_COLUMNS.map((c) => (
            <div
              key={c.key}
              title={c.hint}
              className="rounded-xl border border-border/70 bg-background/80 px-3 py-2 text-center"
            >
              <div className="text-[11px] text-muted-foreground">{c.label}</div>
              <div className="text-sm font-semibold">
                <AgingValue value={footer[c.key]} tone={c.tone} />
              </div>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          חלוקת החוב לפי ימי איחור · ׳צפוי׳ = טרם הגיע מועד התשלום (תשלום עתידי מתוזמן, למשל צ׳ק דחוי).
        </p>
      </div>

      {selectedGroups.length > 0 ? (
        <BulkActions groups={selectedGroups} onClear={clearSelection} />
      ) : null}

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-10 text-center text-sm text-muted-foreground">
          {filter === "all" && !search.trim() && domain === "all"
            ? "אין חובות פתוחים — הכל נגבה! 🎉"
            : "אין פריטים שתואמים לסינון."}
        </div>
      ) : (
        <>
          {/* Desktop: aging table with a sticky header */}
          <div className="hidden max-h-[70vh] overflow-auto rounded-2xl border border-border/70 sm:block">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-muted">
                <tr className="border-b border-border/70 text-xs text-muted-foreground">
                  <th className="px-3 py-2 text-right font-medium">
                    <span className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        aria-label="בחר הכל"
                        checked={allSelected}
                        onChange={toggleSelectAll}
                        className="h-4 w-4"
                      />
                      לקוח
                    </span>
                  </th>
                  <th className="px-3 py-2 text-right font-medium">טלפון</th>
                  <th className="px-3 py-2 text-right font-medium">סטטוס</th>
                  <th className="px-3 py-2 text-right font-medium">יצירת קשר</th>
                  <th className="px-3 py-2 text-right font-medium">תזכורת</th>
                  <th className="px-3 py-2 text-center font-medium">סה״כ חוב</th>
                  <th className="px-2 py-2 text-center font-medium">פעולות</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((group) => {
                  const key = group.customer_id ?? group.customer_name;
                  const cid = group.customer_id;
                  return (
                    <FragmentRow
                      key={key}
                      group={group}
                      isOpen={expanded.has(key)}
                      onToggle={() => toggle(key)}
                      wa={whatsappLink(group.customer_whatsapp ?? group.customer_phone, buildWaMessage(group))}
                      selected={cid ? selected.has(cid) : false}
                      onToggleSelect={cid ? () => toggleSelect(cid) : undefined}
                      onOpenReminders={onOpenReminders}
                    />
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border/70 bg-muted/30 text-xs font-semibold">
                  <td className="px-3 py-2 text-right" colSpan={5}>
                    סה״כ ({filtered.length} לקוחות)
                  </td>
                  <td className="px-3 py-2 text-center">{formatCurrency(footer.outstanding)}</td>
                  <td className="px-2 py-2" />
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Mobile: cards */}
          <div className="space-y-3 sm:hidden">
            {filtered.map((group) => {
              const key = group.customer_id ?? group.customer_name;
              const cid = group.customer_id;
              return (
                <CustomerCard
                  key={key}
                  group={group}
                  isOpen={expanded.has(key)}
                  onToggle={() => toggle(key)}
                  wa={whatsappLink(group.customer_whatsapp ?? group.customer_phone, buildWaMessage(group))}
                  selected={cid ? selected.has(cid) : false}
                  onToggleSelect={cid ? () => toggleSelect(cid) : undefined}
                  onOpenReminders={onOpenReminders}
                />
              );
            })}
            <div className="rounded-2xl border border-border/70 bg-muted/30 p-3 text-sm font-semibold">
              סה״כ ({filtered.length} לקוחות): {formatCurrency(footer.outstanding)}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function FragmentRow({
  group,
  isOpen,
  onToggle,
  wa,
  selected,
  onToggleSelect,
  onOpenReminders,
}: {
  group: CollectionCustomerGroup;
  isOpen: boolean;
  onToggle: () => void;
  wa: string | null;
  selected: boolean;
  onToggleSelect?: () => void;
  onOpenReminders: (customerId: string | null) => void;
}) {
  const tint = severityTint(group);
  return (
    <>
      <tr className={`border-b border-border/50 hover:bg-muted/30 ${tint}`}>
        <td className="px-3 py-2">
          <div className="flex items-start gap-2">
            {onToggleSelect ? (
              <input
                type="checkbox"
                aria-label="בחירת לקוח"
                checked={selected}
                onChange={onToggleSelect}
                className="mt-1 h-4 w-4 shrink-0"
              />
            ) : null}
            <div className="min-w-0">
              <button
                type="button"
                onClick={onToggle}
                className="flex items-center gap-1 text-right font-medium hover:underline"
              >
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`}
                />
                <span>{group.customer_name}</span>
              </button>
            </div>
          </div>
        </td>
        <td className="px-3 py-2 text-muted-foreground">
          {group.customer_phone ? (
            <a href={`tel:${group.customer_phone}`} className="hover:underline">
              {group.customer_phone}
            </a>
          ) : (
            <span className="text-muted-foreground/50">—</span>
          )}
        </td>
        <td className="px-3 py-2">
          <Badge className={collectionStatusClasses(group.status)}>
            {collectionStatusLabel(group.status)}
          </Badge>
          {group.oldest_days_late > 0 ? (
            <div className="mt-0.5 text-[11px] text-destructive">
              {group.oldest_days_late} ימים באיחור
            </div>
          ) : null}
        </td>
        <td className="px-3 py-2">
          <LastContactSignal
            lastContactAt={group.last_contact_at}
            overdue={group.overdue_amount > 0.009}
          />
        </td>
        <td className="px-3 py-2">
          {group.next_reminder_at ? (
            <button
              type="button"
              onClick={() => onOpenReminders(group.customer_id)}
              title="מעבר לתזכורת"
              className="text-xs text-primary hover:underline"
            >
              🔔 {formatDate(group.next_reminder_at)}
            </button>
          ) : (
            <span className="text-muted-foreground/40">—</span>
          )}
        </td>
        <td className="px-3 py-2 text-center font-semibold">{formatCurrency(group.outstanding_amount)}</td>
        <td className="px-2 py-2">
          <div className="flex items-center justify-center">
            <CustomerActions group={group} wa={wa} />
          </div>
        </td>
      </tr>
      {isOpen ? (
        <tr className={`border-b border-border/50 ${tint || "bg-muted/10"}`}>
          <td colSpan={7} className="px-3 py-3">
            <div className="space-y-2">
              {group.sources.map((source) => (
                <SourceDetail key={source.collection_key} source={source} />
              ))}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function RemindersView({
  reminders,
  onUpdate,
  focusCustomerId,
}: {
  reminders: Reminder[];
  onUpdate: (id: string, status: "done" | "cancelled") => void;
  focusCustomerId?: string | null;
}) {
  const today = todayIso();
  const groups = useMemo(() => {
    const overdue: Reminder[] = [];
    const todayList: Reminder[] = [];
    const upcoming: Reminder[] = [];
    for (const r of reminders) {
      const day = r.remind_at.slice(0, 10);
      if (day < today) overdue.push(r);
      else if (day === today) todayList.push(r);
      else upcoming.push(r);
    }
    return { overdue, today: todayList, upcoming };
  }, [reminders, today]);

  // When arriving from a debtor row, scroll to that customer's reminder.
  useEffect(() => {
    if (!focusCustomerId) return;
    const el = document.querySelector<HTMLElement>(`[data-reminder-customer="${focusCustomerId}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusCustomerId]);

  if (reminders.length === 0) {
    return (
      <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-10 text-center text-sm text-muted-foreground">
        אין תזכורות פתוחות.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {groups.overdue.length > 0 ? (
        <ReminderGroup title="באיחור" tone="danger" reminders={groups.overdue} onUpdate={onUpdate} focusCustomerId={focusCustomerId} />
      ) : null}
      {groups.today.length > 0 ? (
        <ReminderGroup title="היום" tone="warning" reminders={groups.today} onUpdate={onUpdate} focusCustomerId={focusCustomerId} />
      ) : null}
      {groups.upcoming.length > 0 ? (
        <ReminderGroup title="קרובות" reminders={groups.upcoming} onUpdate={onUpdate} focusCustomerId={focusCustomerId} />
      ) : null}
    </div>
  );
}

function ReminderGroup({
  title,
  tone = "default",
  reminders,
  onUpdate,
  focusCustomerId,
}: {
  title: string;
  tone?: "default" | "danger" | "warning";
  reminders: Reminder[];
  onUpdate: (id: string, status: "done" | "cancelled") => void;
  focusCustomerId?: string | null;
}) {
  const titleClass =
    tone === "danger" ? "text-destructive" : tone === "warning" ? "text-warning-strong" : "text-foreground";
  return (
    <div className="space-y-2">
      <div className={`text-sm font-semibold ${titleClass}`}>
        {title} ({reminders.length})
      </div>
      {reminders.map((r) => (
        <div
          key={r.id}
          data-reminder-customer={r.customer_id ?? undefined}
          className={`rounded-xl border p-3 text-sm ${
            focusCustomerId && r.customer_id === focusCustomerId
              ? "border-primary ring-2 ring-primary"
              : tone === "danger"
                ? "border-destructive/40 bg-destructive-soft/40"
                : "border-border/70 bg-card/60"
          }`}
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                {r.customer_id ? (
                  <NavLink to={`/customers/${r.customer_id}`} className="font-medium hover:underline">
                    {r.customer_name ?? "לקוח"}
                  </NavLink>
                ) : (
                  <span className="font-medium">{r.customer_name ?? "כללי"}</span>
                )}
                <span className="text-xs text-muted-foreground">
                  {actionTypeLabel(r.action_type)} · {formatShortDate(r.remind_at)}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 text-muted-foreground">
                {r.customer_phone ? (
                  <a href={`tel:${r.customer_phone}`} className="hover:underline">
                    ☎ {r.customer_phone}
                  </a>
                ) : null}
                {r.assigned_to_name ? <span>אחראי: {r.assigned_to_name}</span> : null}
              </div>
              {r.content ? <div className="mt-1">{r.content}</div> : null}
            </div>
            <div className="flex shrink-0 gap-1">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={() => onUpdate(r.id, "done")}
              >
                בוצע
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 text-xs"
                onClick={() => onUpdate(r.id, "cancelled")}
              >
                בטל
              </Button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ActivityView({
  logs,
  onChanged,
}: {
  logs: CommunicationLogWithCustomer[];
  onChanged: () => void;
}) {
  if (logs.length === 0) {
    return (
      <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-10 text-center text-sm text-muted-foreground">
        עדיין לא תועדו שיחות.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {logs.map((log) => (
        <CommunicationLogItem key={log.id} log={log} showCustomer onChanged={onChanged} />
      ))}
    </div>
  );
}

"use client";

// Presentational components for CollectionsClient. No business logic lives here
// (that's in CollectionsClient.helpers.ts); these render props and call back. The
// orchestrator (CollectionsClient.tsx) owns the page state and data.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, MessageCircle, Phone, type LucideIcon } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { Badge } from "@/components/ui/badge";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { formatShortDate, formatShortDateTime } from "@/lib/date";
import {
  collectionStatusClasses,
  collectionStatusLabel,
  paymentMethodLabel,
} from "@/lib/orders/paymentStatus";
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
import {
  buildWaMessage,
  daysSince,
  filterExpectedReceipts,
  flattenExpectedReceipts,
  formatCurrency,
  formatDate,
  groupHasPendingCheck,
  groupReminders,
  presentReceiptMethodChips,
  severityTint,
  todayIso,
  whatsappLink,
  type ExpectedReceipt,
  type FilterKey,
  type SortKey,
} from "@/app/(app)/collections/CollectionsClient.helpers";

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

// Underline-style top tab: active = solid foreground text + underline, the rest muted.
export function ViewTab({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px flex items-center gap-1 rounded-t-md border-b-[3px] px-2 pb-2 pt-1 text-base transition-colors hover:bg-muted/60 ${
        active
          ? "border-primary font-bold text-primary"
          : "border-transparent font-medium text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon className="h-4 w-4" />
      {children}
    </button>
  );
}

// "להיום" — the landing digest: reminders due today/overdue + payments to collect
// today. Renders nothing on a clear day so the call log (default tab) leads.
export function TodayOverview({
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
                    {r.task_subject ? (
                      <NavLink to={`/tasks/${r.task_id}`} className="font-medium hover:underline">
                        {r.task_subject}
                      </NavLink>
                    ) : r.customer_id ? (
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
                    <span className="text-muted-foreground">{r.task_subject ? "משימה" : actionTypeLabel(r.action_type)}</span>
                    {r.content ? <span className="text-muted-foreground">· {r.content}</span> : null}
                    <span className={overdue ? "font-medium text-destructive" : "text-muted-foreground"}>
                      {overdue ? "באיחור · " : ""}
                      {formatShortDateTime(r.remind_at)}
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

// A loan is repaid on the loans page (partial amounts / interest), so the row
// links straight to that loan's repayment dialog instead of collecting inline.
function LoanRepaymentLink({ loanId }: { loanId: string }) {
  return (
    <Button asChild size="sm" variant="outline" className="h-7 text-xs">
      <NavLink to={`/financial/loans?repay=${loanId}`}>רישום החזר</NavLink>
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
  const isLoan = source.source_type === "loan";
  const href = isLoan
    ? "/financial/loans"
    : isOrder
      ? `/sales/orders/${source.source_id}`
      : `/projects/${source.source_id}`;
  const linkText = isLoan
    ? source.title
      ? `הלוואה — ${source.title}`
      : "הלוואה"
    : isOrder
      ? `הזמנה #${source.source_id.slice(0, 8)}`
      : source.title ?? `פרויקט #${source.source_id.slice(0, 8)}`;
  const pendingIds = source.pending_payments.map((p) => p.id);
  const checkPayment = source.pending_payments.find((p) => p.payment_method === "check");
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
        {checkPayment ? (
          <Badge variant="info" className="gap-1 text-[10px]">
            צ׳ק{checkPayment.check_number ? ` מס׳ ${checkPayment.check_number}` : ""}
          </Badge>
        ) : null}
        <span className="text-muted-foreground">תאריך: {formatDate(source.reference_date)}</span>
        <span className="font-semibold text-foreground">{formatCurrency(source.outstanding_amount)}</span>
        {source.payment_terms ? (
          <span className="text-muted-foreground">צורת תשלום: {paymentTermsLabel(source.payment_terms)}</span>
        ) : null}
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
        ) : isLoan ? (
          <span className="ms-auto">
            <LoanRepaymentLink loanId={source.source_id} />
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
              {groupHasPendingCheck(group) ? (
                <Badge variant="info" className="gap-1 text-[10px]">צ׳ק</Badge>
              ) : null}
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

// ─── Expected receipts (תקבולים צפויים) ─────────────────────────────────────
// A flat, payment-centric view of every future-dated / uncleared receivable.

function ExpectedReceiptRow({ receipt }: { receipt: ExpectedReceipt }) {
  const href =
    receipt.sourceType === "order"
      ? `/sales/orders/${receipt.sourceId}`
      : `/projects/${receipt.sourceId}`;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 bg-background/60 p-3 text-sm">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <span className="shrink-0 rounded-md border border-border/70 px-1.5 py-0.5 text-xs text-muted-foreground">
          {paymentMethodLabel(receipt.methodRaw)}
        </span>
        {receipt.customerId ? (
          <NavLink to={`/customers/${receipt.customerId}`} className="font-medium hover:underline">
            {receipt.customerName}
          </NavLink>
        ) : (
          <span className="font-medium">{receipt.customerName}</span>
        )}
        {receipt.customerPhone ? (
          <a href={`tel:${receipt.customerPhone}`} className="text-muted-foreground hover:underline">
            ☎ {receipt.customerPhone}
          </a>
        ) : null}
        {receipt.checkNumber ? (
          <span className="font-mono text-xs text-muted-foreground">מס׳ {receipt.checkNumber}</span>
        ) : null}
        <NavLink to={href} target="_blank" rel="noreferrer" className="text-primary hover:underline">
          {receipt.sourceType === "order" ? "הזמנה" : "פרויקט"}
        </NavLink>
        <span className={receipt.overdue ? "font-medium text-destructive" : "text-muted-foreground"}>
          {receipt.overdue ? "באיחור · " : "פירעון "}
          {receipt.dueDate ? formatShortDate(receipt.dueDate) : "—"}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span className="font-semibold">{formatCurrency(receipt.amount)}</span>
        <MarkCollectedButton paymentIds={[receipt.paymentId]} />
      </div>
    </div>
  );
}

function ExpectedReceiptsView({
  receipts,
  search,
  setSearch,
}: {
  receipts: ExpectedReceipt[];
  search: string;
  setSearch: (s: string) => void;
}) {
  const [method, setMethod] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const methodChips = useMemo(() => presentReceiptMethodChips(receipts), [receipts]);
  const filtered = useMemo(
    () => filterExpectedReceipts(receipts, { method, from, to, search }),
    [receipts, method, from, to, search]
  );

  const total = filtered.reduce((sum, r) => sum + r.amount, 0);

  return (
    <div className="space-y-3">
      {/* Payment-method chips — horizontally scrollable on mobile */}
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {methodChips.map((m) => (
          <Button
            key={m.key}
            type="button"
            size="sm"
            variant={method === m.key ? "default" : "outline"}
            className="shrink-0"
            onClick={() => setMethod(m.key)}
          >
            {m.label}
          </Button>
        ))}
      </div>

      {/* Due-date range + search */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">מ־</span>
          <DateInput value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-32" />
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">עד</span>
          <DateInput value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-32" />
        </div>
        {from || to ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setFrom("");
              setTo("");
            }}
          >
            נקה תאריך
          </Button>
        ) : null}
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="חיפוש לפי שם / טלפון / מס׳ צ׳ק..."
          className="h-9 w-full sm:w-56"
        />
      </div>

      {/* Totals for the current filter */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="text-muted-foreground">{filtered.length} תקבולים</span>
        <span className="text-border">·</span>
        <span className="font-semibold">סה״כ {formatCurrency(total)}</span>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-10 text-center text-sm text-muted-foreground">
          {receipts.length === 0 ? "אין תקבולים צפויים." : "אין תקבולים שתואמים לסינון."}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => (
            <ExpectedReceiptRow key={r.paymentId} receipt={r} />
          ))}
        </div>
      )}
    </div>
  );
}

export function DebtorsTable({
  totals,
  customers,
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
  totals: { outstanding: number; pending: number; overdue: number; customerCount: number };
  customers: CollectionCustomerGroup[];
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
  // Sub-view inside חייבים: the customer worklist, or a flat list of all the
  // expected (future-dated) receipts filterable by payment method + due date.
  const [subView, setSubView] = useState<"customers" | "receipts">("customers");
  const expectedReceipts = useMemo(() => flattenExpectedReceipts(customers), [customers]);
  const tabs: { key: FilterKey; label: string }[] = [
    { key: "all", label: "הכל" },
    { key: "overdue", label: "באיחור" },
    { key: "due_soon", label: "לגבייה בקרוב" },
    { key: "expected", label: "תשלום צפוי" },
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
      acc.outstanding += c.outstanding_amount;
      return acc;
    },
    { outstanding: 0 }
  );

  return (
    <div className="space-y-3">
      {/* Compact stats line — replaces the old 4-card grid */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="text-muted-foreground">סה״כ לגבייה</span>
        <span className="font-semibold">{formatCurrency(totals.outstanding)}</span>
        <span className="text-border">·</span>
        <span className="text-muted-foreground">באיחור</span>
        <span className="font-semibold text-destructive">{formatCurrency(totals.overdue)}</span>
        <span className="text-border">·</span>
        <span className="text-muted-foreground">צפוי</span>
        <span className="font-semibold text-warning-strong">{formatCurrency(totals.pending)}</span>
        <span className="text-border">·</span>
        <span className="text-muted-foreground">{totals.customerCount} לקוחות</span>
      </div>

      {/* Switch between the per-customer worklist and the flat expected-receipts list */}
      <div className="flex w-fit rounded-xl border bg-secondary/40 p-0.5 text-sm">
        <button
          type="button"
          onClick={() => setSubView("customers")}
          className={`rounded-lg px-3 py-1 transition-colors ${
            subView === "customers"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-secondary/10"
          }`}
        >
          לקוחות ({totals.customerCount})
        </button>
        <button
          type="button"
          onClick={() => setSubView("receipts")}
          className={`rounded-lg px-3 py-1 transition-colors ${
            subView === "receipts"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-secondary/10"
          }`}
        >
          תקבולים צפויים ({expectedReceipts.length})
        </button>
      </div>

      {subView === "receipts" ? (
        <ExpectedReceiptsView receipts={expectedReceipts} search={search} setSearch={setSearch} />
      ) : (
        <>
          {/* All filters in one row: search, then status / sort / domain dropdowns */}
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="חיפוש לפי שם או טלפון..."
              className="h-9 w-full sm:w-56"
            />
            <NativeSelect dense
              value={filter}
              onChange={(e) => setFilter(e.target.value as FilterKey)}
            >
              {tabs.map((tab) => (
                <option key={tab.key} value={tab.key}>
                  הצג: {tab.label}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect dense
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
            >
              <option value="amount">מיון: סכום</option>
              <option value="oldest">מיון: ותק החוב</option>
              <option value="due">מיון: תאריך פירעון</option>
              <option value="name">מיון: שם</option>
            </NativeSelect>
            {domainOptions.length > 1 ? (
              <NativeSelect dense
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
              >
                <option value="all">כל התחומים</option>
                {domainOptions.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </NativeSelect>
            ) : null}
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
          <div className="flex flex-wrap items-center gap-1">
            <Badge className={collectionStatusClasses(group.status)}>
              {collectionStatusLabel(group.status)}
            </Badge>
            {groupHasPendingCheck(group) ? (
              <Badge variant="info" className="gap-1 text-[10px]">צ׳ק</Badge>
            ) : null}
          </div>
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

export function RemindersView({
  reminders,
  onUpdate,
  onEdit,
  focusCustomerId,
}: {
  reminders: Reminder[];
  onUpdate: (id: string, status: "done" | "cancelled") => void;
  onEdit: (reminder: Reminder) => void;
  focusCustomerId?: string | null;
}) {
  const groups = useMemo(() => groupReminders(reminders), [reminders]);

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
        <ReminderGroup title="באיחור" tone="danger" reminders={groups.overdue} onUpdate={onUpdate} onEdit={onEdit} focusCustomerId={focusCustomerId} />
      ) : null}
      {groups.today.length > 0 ? (
        <ReminderGroup title="היום" tone="warning" reminders={groups.today} onUpdate={onUpdate} onEdit={onEdit} focusCustomerId={focusCustomerId} />
      ) : null}
      {groups.upcoming.length > 0 ? (
        <ReminderGroup title="קרובות" reminders={groups.upcoming} onUpdate={onUpdate} onEdit={onEdit} focusCustomerId={focusCustomerId} />
      ) : null}
    </div>
  );
}

function ReminderGroup({
  title,
  tone = "default",
  reminders,
  onUpdate,
  onEdit,
  focusCustomerId,
}: {
  title: string;
  tone?: "default" | "danger" | "warning";
  reminders: Reminder[];
  onUpdate: (id: string, status: "done" | "cancelled") => void;
  onEdit: (reminder: Reminder) => void;
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
                {r.task_subject ? (
                  <NavLink to={`/tasks/${r.task_id}`} className="font-medium hover:underline">
                    {r.task_subject}
                  </NavLink>
                ) : r.customer_id ? (
                  <NavLink to={`/customers/${r.customer_id}`} className="font-medium hover:underline">
                    {r.customer_name ?? "לקוח"}
                  </NavLink>
                ) : (
                  <span className="font-medium">{r.customer_name ?? "כללי"}</span>
                )}
                <span className="text-xs text-muted-foreground">
                  {r.task_subject ? "משימה" : actionTypeLabel(r.action_type)} · {formatShortDateTime(r.remind_at)}
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
                onClick={() => onEdit(r)}
              >
                ערוך
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

export function ActivityView({
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

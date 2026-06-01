"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, MessageCircle } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatShortDate } from "@/lib/date";
import { getBusinessDomainLabel } from "@/lib/expenses";
import { collectionStatusClasses, collectionStatusLabel } from "@/lib/orders/paymentStatus";
import {
  actionTypeLabel,
  channelLabel,
  directionLabel,
  type CommunicationLogWithCustomer,
  type Reminder,
} from "@/lib/communications";
import CustomerCollectionButton from "@/components/collections/CustomerCollectionButton";
import type { CollectionCustomerGroup, PaymentDueToday } from "@/lib/collections";

type Props = {
  customers: CollectionCustomerGroup[];
  totals: { outstanding: number; pending: number; overdue: number; customerCount: number };
  reminders: Reminder[];
  recentLogs: CommunicationLogWithCustomer[];
  dueToday: PaymentDueToday[];
};

type View = "debtors" | "reminders" | "activity";
type FilterKey = "all" | "overdue" | "due_soon";
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
        ? "text-warning-soft-foreground"
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
  reminders,
  recentLogs,
  dueToday,
}: Props) {
  const router = useRouter();
  const [view, setView] = useState<View>("debtors");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [search, setSearch] = useState("");
  const [domain, setDomain] = useState("all");
  const [sort, setSort] = useState<SortKey>("amount");
  const [collectingId, setCollectingId] = useState<string | null>(null);

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
    const res = await fetch("/api/reminders/update", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    if (res.ok) router.refresh();
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
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="סה״כ לגבייה" value={formatCurrency(totals.outstanding)} />
        <SummaryCard label="באיחור" value={formatCurrency(totals.overdue)} tone="danger" />
        <SummaryCard label="צפוי (טרם נגבה)" value={formatCurrency(totals.pending)} tone="warning" />
        <SummaryCard label="לקוחות חייבים" value={`${totals.customerCount}`} />
      </div>

      {/* Today's due payments — on top, money to collect now */}
      {dueToday.length > 0 ? (
        <DueTodaySection dueToday={dueToday} collectingId={collectingId} onCollect={markCollected} />
      ) : null}

      {/* View switch */}
      <div className="flex flex-wrap gap-2 border-b border-border/60 pb-2">
        <Button
          type="button"
          size="sm"
          variant={view === "debtors" ? "default" : "ghost"}
          onClick={() => setView("debtors")}
        >
          חייבים
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
          variant={view === "activity" ? "default" : "ghost"}
          onClick={() => setView("activity")}
        >
          יומן שיחות{recentLogs.length ? ` (${recentLogs.length})` : ""}
        </Button>
      </div>

      {view === "debtors" ? (
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
        />
      ) : view === "reminders" ? (
        <RemindersView reminders={reminders} onUpdate={updateReminder} />
      ) : (
        <ActivityView logs={recentLogs} />
      )}
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

const AGING_COLUMNS: { key: keyof CollectionCustomerGroup["aging"]; label: string; tone: "muted" | "warning" | "danger" }[] = [
  { key: "current", label: "שוטף", tone: "muted" },
  { key: "d30", label: "1-30", tone: "muted" },
  { key: "d60", label: "31-60", tone: "warning" },
  { key: "d90", label: "61-90", tone: "warning" },
  { key: "d90plus", label: "90+", tone: "danger" },
];

function AgingValue({ value, tone }: { value: number; tone: "muted" | "warning" | "danger" }) {
  if (value <= 0.009) return <span className="text-muted-foreground/40">—</span>;
  const cls =
    tone === "danger"
      ? "font-semibold text-destructive"
      : tone === "warning"
        ? "font-medium text-warning-soft-foreground"
        : "";
  return <span className={cls}>{formatCurrency(value)}</span>;
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
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const tabs: { key: FilterKey; label: string }[] = [
    { key: "all", label: "הכל" },
    { key: "overdue", label: "באיחור" },
    { key: "due_soon", label: "לגבייה בקרוב" },
  ];

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

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

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-10 text-center text-sm text-muted-foreground">
          {filter === "all" && !search.trim() && domain === "all"
            ? "אין חובות פתוחים — הכל נגבה! 🎉"
            : "אין פריטים שתואמים לסינון."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border/70">
          <table className="w-full min-w-[820px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border/70 bg-muted/40 text-xs text-muted-foreground">
                <th className="px-3 py-2 text-right font-medium">לקוח</th>
                <th className="px-3 py-2 text-right font-medium">טלפון</th>
                <th className="px-3 py-2 text-right font-medium">סטטוס</th>
                {AGING_COLUMNS.map((c) => (
                  <th key={c.key} className="px-2 py-2 text-center font-medium">
                    {c.label}
                  </th>
                ))}
                <th className="px-3 py-2 text-center font-medium">סה״כ חוב</th>
                <th className="px-2 py-2 text-center font-medium">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((group) => {
                const key = group.customer_id ?? group.customer_name;
                const isOpen = expanded.has(key);
                const waMessage = `שלום, נותרה יתרה לתשלום בסך ${formatCurrency(group.outstanding_amount)}. נשמח להסדרת התשלום. תודה!`;
                const wa = whatsappLink(group.customer_whatsapp ?? group.customer_phone, waMessage);
                return (
                  <FragmentRow
                    key={key}
                    group={group}
                    isOpen={isOpen}
                    onToggle={() => toggle(key)}
                    wa={wa}
                  />
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border/70 bg-muted/30 text-xs font-semibold">
                <td className="px-3 py-2 text-right" colSpan={3}>
                  סה״כ ({filtered.length} לקוחות)
                </td>
                {AGING_COLUMNS.map((c) => (
                  <td key={c.key} className="px-2 py-2 text-center">
                    <AgingValue value={footer[c.key]} tone={c.tone} />
                  </td>
                ))}
                <td className="px-3 py-2 text-center">{formatCurrency(footer.outstanding)}</td>
                <td className="px-2 py-2" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

function FragmentRow({
  group,
  isOpen,
  onToggle,
  wa,
}: {
  group: CollectionCustomerGroup;
  isOpen: boolean;
  onToggle: () => void;
  wa: string | null;
}) {
  return (
    <>
      <tr className="border-b border-border/50 hover:bg-muted/30">
        <td className="px-3 py-2">
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
        {AGING_COLUMNS.map((c) => (
          <td key={c.key} className="px-2 py-2 text-center text-xs">
            <AgingValue value={group.aging[c.key]} tone={c.tone} />
          </td>
        ))}
        <td className="px-3 py-2 text-center font-semibold">{formatCurrency(group.outstanding_amount)}</td>
        <td className="px-2 py-2">
          <div className="flex items-center justify-center gap-1">
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
        </td>
      </tr>
      {isOpen ? (
        <tr className="border-b border-border/50 bg-muted/10">
          <td colSpan={10} className="px-3 py-3">
            <div className="space-y-2">
              {group.sources.map((source) => {
                const isOrder = source.source_type === "order";
                const href = isOrder
                  ? `/sales/orders/${source.source_id}`
                  : `/projects/${source.source_id}`;
                const linkText = isOrder
                  ? `הזמנה #${source.source_id.slice(0, 8)}`
                  : source.title ?? `פרויקט #${source.source_id.slice(0, 8)}`;
                return (
                  <div
                    key={source.collection_key}
                    className="rounded-lg border border-border/50 bg-background/60 p-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <NavLink
                          to={href}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium text-primary hover:underline"
                        >
                          {linkText}
                        </NavLink>
                        <span className="text-xs text-muted-foreground">
                          {getBusinessDomainLabel(source.business_domain)}
                        </span>
                        <Badge className={collectionStatusClasses(source.collection_status)}>
                          {collectionStatusLabel(source.collection_status)}
                        </Badge>
                        {source.days_late > 0 ? (
                          <span className="text-xs font-medium text-destructive">
                            {source.days_late} ימים באיחור
                          </span>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span>תאריך: {formatDate(source.reference_date)}</span>
                        {source.next_due_date ? <span>פירעון: {formatDate(source.next_due_date)}</span> : null}
                        <span className="font-semibold text-foreground">
                          {formatCurrency(source.outstanding_amount)}
                        </span>
                      </div>
                    </div>
                    {isOrder && source.items.length > 0 ? (
                      <div className="mt-1 text-xs text-muted-foreground">{source.items.join(" · ")}</div>
                    ) : null}
                  </div>
                );
              })}
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
}: {
  reminders: Reminder[];
  onUpdate: (id: string, status: "done" | "cancelled") => void;
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
        <ReminderGroup title="באיחור" tone="danger" reminders={groups.overdue} onUpdate={onUpdate} />
      ) : null}
      {groups.today.length > 0 ? (
        <ReminderGroup title="היום" tone="warning" reminders={groups.today} onUpdate={onUpdate} />
      ) : null}
      {groups.upcoming.length > 0 ? (
        <ReminderGroup title="קרובות" reminders={groups.upcoming} onUpdate={onUpdate} />
      ) : null}
    </div>
  );
}

function ReminderGroup({
  title,
  tone = "default",
  reminders,
  onUpdate,
}: {
  title: string;
  tone?: "default" | "danger" | "warning";
  reminders: Reminder[];
  onUpdate: (id: string, status: "done" | "cancelled") => void;
}) {
  const titleClass =
    tone === "danger" ? "text-destructive" : tone === "warning" ? "text-warning-soft-foreground" : "text-foreground";
  return (
    <div className="space-y-2">
      <div className={`text-sm font-semibold ${titleClass}`}>
        {title} ({reminders.length})
      </div>
      {reminders.map((r) => (
        <div
          key={r.id}
          className={`rounded-xl border p-3 text-sm ${
            tone === "danger" ? "border-destructive/40 bg-destructive-soft/40" : "border-border/70 bg-card/60"
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

function ActivityView({ logs }: { logs: CommunicationLogWithCustomer[] }) {
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
        <div key={log.id} className="rounded-xl border border-border/60 bg-card/60 p-3 text-sm">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {log.customer_id ? (
              <NavLink to={`/customers/${log.customer_id}`} className="font-medium hover:underline">
                {log.customer_name ?? "לקוח"}
              </NavLink>
            ) : (
              <span className="font-medium">{log.customer_name ?? "כללי"}</span>
            )}
            {log.customer_phone ? (
              <a href={`tel:${log.customer_phone}`} className="text-xs text-muted-foreground hover:underline">
                ☎ {log.customer_phone}
              </a>
            ) : null}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span>{channelLabel(log.channel)}</span>
            <span>· {directionLabel(log.direction)}</span>
            <span>· {formatDateTime(log.created_at)}</span>
            {log.created_by_name ? <span>· {log.created_by_name}</span> : null}
          </div>
          {log.content ? <div className="mt-1">{log.content}</div> : null}
        </div>
      ))}
    </div>
  );
}

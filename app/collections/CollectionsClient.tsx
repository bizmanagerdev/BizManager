"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { NavLink } from "@/components/NavLink";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatShortDate } from "@/lib/date";
import { getBusinessDomainLabel } from "@/lib/expenses";
import { collectionStatusClasses, collectionStatusLabel } from "@/lib/orders/paymentStatus";
import { actionTypeLabel, type Reminder } from "@/lib/communications";
import CustomerCollectionButton from "@/components/collections/CustomerCollectionButton";
import type { CollectionCustomerGroup } from "@/lib/collections";

type Props = {
  customers: CollectionCustomerGroup[];
  totals: { outstanding: number; pending: number; overdue: number; customerCount: number };
  reminders: Reminder[];
};

type View = "debtors" | "reminders";
type FilterKey = "all" | "overdue" | "due_soon";

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

export default function CollectionsClient({ customers, totals, reminders }: Props) {
  const router = useRouter();
  const [view, setView] = useState<View>("debtors");
  const [filter, setFilter] = useState<FilterKey>("all");

  const filtered = useMemo(() => {
    if (filter === "overdue") return customers.filter((c) => c.overdue_amount > 0.009);
    if (filter === "due_soon") {
      return customers.filter((c) => isDueSoon(c.next_due_date) || c.overdue_amount > 0.009);
    }
    return customers;
  }, [customers, filter]);

  const overdueReminderCount = reminders.filter((r) => r.remind_at.slice(0, 10) < todayIso()).length;

  async function updateReminder(id: string, status: "done" | "cancelled") {
    const res = await fetch("/api/reminders/update", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    if (res.ok) router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="סה״כ לגבייה" value={formatCurrency(totals.outstanding)} />
        <SummaryCard label="באיחור" value={formatCurrency(totals.overdue)} tone="danger" />
        <SummaryCard label="צפוי (טרם נגבה)" value={formatCurrency(totals.pending)} tone="warning" />
        <SummaryCard label="לקוחות חייבים" value={`${totals.customerCount}`} />
      </div>

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
      </div>

      {view === "debtors" ? (
        <DebtorsView filter={filter} setFilter={setFilter} filtered={filtered} />
      ) : (
        <RemindersView reminders={reminders} onUpdate={updateReminder} />
      )}
    </div>
  );
}

function DebtorsView({
  filter,
  setFilter,
  filtered,
}: {
  filter: FilterKey;
  setFilter: (f: FilterKey) => void;
  filtered: CollectionCustomerGroup[];
}) {
  const tabs: { key: FilterKey; label: string }[] = [
    { key: "all", label: "הכל" },
    { key: "overdue", label: "באיחור" },
    { key: "due_soon", label: "לגבייה בקרוב" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
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
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-10 text-center text-sm text-muted-foreground">
          {filter === "all" ? "אין חובות פתוחים — הכל נגבה! 🎉" : "אין פריטים בקטגוריה זו."}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((group) => (
            <div
              key={group.customer_id ?? group.customer_name}
              className="rounded-2xl border border-border/70 bg-card/70 p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {group.customer_id ? (
                      <NavLink
                        to={`/customers/${group.customer_id}`}
                        className="text-base font-semibold hover:underline"
                      >
                        {group.customer_name}
                      </NavLink>
                    ) : (
                      <span className="text-base font-semibold">{group.customer_name}</span>
                    )}
                    <Badge className={collectionStatusClasses(group.status)}>
                      {collectionStatusLabel(group.status)}
                    </Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                    {group.customer_phone ? (
                      <a href={`tel:${group.customer_phone}`} className="hover:underline">
                        ☎ {group.customer_phone}
                      </a>
                    ) : (
                      <span>אין טלפון</span>
                    )}
                    <span>תשלום הבא: {formatDate(group.next_due_date)}</span>
                    <span>שיחה אחרונה: {formatDate(group.last_contact_at)}</span>
                    {group.next_reminder_at ? (
                      <span className="text-info-soft-foreground">
                        תזכורת: {formatDate(group.next_reminder_at)}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <div className="text-left">
                    <div className="text-lg font-semibold">{formatCurrency(group.outstanding_amount)}</div>
                    {group.overdue_amount > 0.009 ? (
                      <div className="text-xs text-destructive">
                        {formatCurrency(group.overdue_amount)} באיחור
                      </div>
                    ) : null}
                    {group.pending_amount > 0.009 ? (
                      <div className="text-xs text-warning-soft-foreground">
                        {formatCurrency(group.pending_amount)} צפוי
                      </div>
                    ) : null}
                  </div>
                  {group.customer_id ? (
                    <CustomerCollectionButton
                      customerId={group.customer_id}
                      customerName={group.customer_name}
                      customerPhone={group.customer_phone}
                      refreshOnClose
                    />
                  ) : null}
                </div>
              </div>

              <div className="mt-3 space-y-2 border-t border-border/60 pt-3">
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
                      className="rounded-lg border border-border/50 bg-background/40 p-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
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
                            {collectionStatusLabel(source.collection_status, isOrder ? "f" : "m")}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3 text-muted-foreground">
                          <span>חוב: {formatCurrency(source.outstanding_amount)}</span>
                          {source.next_due_date ? (
                            <span>פירעון: {formatDate(source.next_due_date)}</span>
                          ) : null}
                        </div>
                      </div>
                      {isOrder && source.items.length > 0 ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {source.items.join(" · ")}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RemindersView({
  reminders,
  onUpdate,
}: {
  reminders: Reminder[];
  onUpdate: (id: string, status: "done" | "cancelled") => void;
}) {
  if (reminders.length === 0) {
    return (
      <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-10 text-center text-sm text-muted-foreground">
        אין תזכורות פתוחות.
      </div>
    );
  }

  const today = todayIso();

  return (
    <div className="space-y-2">
      {reminders.map((r) => {
        const overdue = r.remind_at.slice(0, 10) < today;
        return (
          <div
            key={r.id}
            className={`rounded-xl border p-3 text-sm ${
              overdue ? "border-destructive/40 bg-destructive-soft/40" : "border-border/70 bg-card/60"
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
                  {overdue ? <span className="text-xs text-destructive">(באיחור)</span> : null}
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
        );
      })}
    </div>
  );
}

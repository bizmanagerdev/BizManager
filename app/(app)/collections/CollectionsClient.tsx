"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Bell, Coins, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { offlineFetch } from "@/lib/offline-queue";
import { formatCurrency } from "@/lib/payroll";
import AddCollectionEntryDialog from "@/components/collections/AddCollectionEntryDialog";
import type { CollectionCustomerGroup, PaymentDueToday } from "@/lib/collections";
import {
  buildDomainOptions,
  filterAndSortDebtors,
  parseInitialFilter,
  type FilterKey,
  type SortKey,
} from "@/app/(app)/collections/CollectionsClient.helpers";
import { DebtorsTable } from "@/app/(app)/collections/CollectionsClient.ui";

// Pure Accounts-Receivable: debtors, aging and payments due today. Calls and
// reminders no longer live here — they're global now (see /communications and
// the "מה דורש טיפול" worklist); a debtor's own calls/reminders/promises show on
// their customer page. Quick "log call / add reminder" stay for the collector's
// convenience.
type Props = {
  customers: CollectionCustomerGroup[];
  totals: { outstanding: number; pending: number; overdue: number; customerCount: number };
  dueToday: PaymentDueToday[];
};

export default function CollectionsClient({ customers, totals, dueToday }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [filter, setFilter] = useState<FilterKey>(parseInitialFilter(searchParams?.get("filter")));
  const [search, setSearch] = useState("");
  const [domain, setDomain] = useState("all");
  const [sort, setSort] = useState<SortKey>("amount");
  const [collectingId, setCollectingId] = useState<string | null>(null);
  const [collectedIds, setCollectedIds] = useState<Set<string>>(() => new Set());
  const [addReminderOpen, setAddReminderOpen] = useState(false);
  const [addCallOpen, setAddCallOpen] = useState(false);

  const domainOptions = useMemo(() => buildDomainOptions(customers), [customers]);
  const filtered = useMemo(
    () => filterAndSortDebtors(customers, { filter, search, domain, sort }),
    [customers, filter, search, domain, sort]
  );
  const pendingDueToday = useMemo(() => dueToday.filter((p) => !collectedIds.has(p.id)), [dueToday, collectedIds]);

  async function markCollected(paymentId: string) {
    setCollectingId(paymentId);
    setCollectedIds((prev) => new Set(prev).add(paymentId));
    try {
      const result = await offlineFetch(
        "/api/payments/mark-collected",
        { id: paymentId, collected: true },
        "סימון תשלום כנגבה"
      );
      if (!result.queued && result.ok) router.refresh();
    } finally {
      setCollectingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Coins className="h-6 w-6" />
            גבייה
          </h1>
          <p className="text-sm text-muted-foreground">חייבים, התיישנות חוב ותשלומים לגבייה. שיחות ותזכורות בכרטיס הלקוח.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => setAddCallOpen(true)}>
            <Phone className="me-1 h-4 w-4 text-success" />
            תיעוד שיחה
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setAddReminderOpen(true)}>
            <Bell className="me-1 h-4 w-4 text-warning" />
            הוספת תזכורת
          </Button>
        </div>
      </div>

      <AddCollectionEntryDialog mode="reminder" open={addReminderOpen} onOpenChange={setAddReminderOpen} onSaved={() => router.refresh()} />
      <AddCollectionEntryDialog mode="call" open={addCallOpen} onOpenChange={setAddCallOpen} onSaved={() => router.refresh()} />

      {pendingDueToday.length > 0 ? (
        <div className="space-y-2 rounded-2xl border border-warning/40 bg-warning/5 p-4">
          <div className="text-sm font-semibold">תשלומים לגבייה היום</div>
          {pendingDueToday.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="min-w-0">
                {p.customer_name}
                {p.customer_phone ? ` · ${p.customer_phone}` : ""} — {formatCurrency(p.amount)}
              </span>
              <Button size="sm" variant="secondary" disabled={collectingId === p.id} onClick={() => markCollected(p.id)}>
                נגבה
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      <DebtorsTable
        totals={totals}
        customers={customers}
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
        onOpenReminders={(customerId) => {
          if (customerId) router.push(`/customers/${customerId}#collection-tracking`);
        }}
      />
    </div>
  );
}

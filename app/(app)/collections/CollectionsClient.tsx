"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { offlineFetch } from "@/lib/offline-queue";
import { formatCurrency } from "@/lib/payroll";
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
// their customer page. No page-level heading/description/action-buttons block —
// none of the other list pages repeat themselves that way either.
type Props = {
  customers: CollectionCustomerGroup[];
  totals: { outstanding: number; pending: number; overdue: number; actionable: number; customerCount: number };
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

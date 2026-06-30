"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Bell, Coins, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toHebrewError } from "@/lib/error-messages";
import { offlineFetch } from "@/lib/offline-queue";
import { type CommunicationLogWithCustomer, type Reminder } from "@/lib/communications";
import AddCollectionEntryDialog from "@/components/collections/AddCollectionEntryDialog";
import EditReminderDialog from "@/components/collections/EditReminderDialog";
import type { CollectionCustomerGroup, PaymentDueToday } from "@/lib/collections";
import {
  buildDomainOptions,
  filterAndSortDebtors,
  parseInitialFilter,
  parseInitialView,
  todayIso,
  type FilterKey,
  type SortKey,
  type View,
} from "@/app/(app)/collections/CollectionsClient.helpers";
import {
  ActivityView,
  DebtorsTable,
  RemindersView,
  TodayOverview,
  ViewTab,
} from "@/app/(app)/collections/CollectionsClient.ui";

type Props = {
  customers: CollectionCustomerGroup[];
  totals: { outstanding: number; pending: number; overdue: number; customerCount: number };
  /** Reminders I own/created (always supplied). */
  remindersMine: Reminder[];
  /** Everyone's reminders (admin/office only; empty otherwise). */
  remindersAll: Reminder[];
  canSeeAll: boolean;
  recentLogs: CommunicationLogWithCustomer[];
  dueToday: PaymentDueToday[];
};

export default function CollectionsClient({
  customers,
  totals,
  remindersMine,
  remindersAll,
  canSeeAll,
  recentLogs,
  dueToday,
}: Props) {
  const router = useRouter();
  // Deep-link support: the dashboard alert center links here with ?view= & ?filter=
  // (e.g. ?view=debtors&filter=uncontacted) so a click lands on the right tab/filter.
  const searchParams = useSearchParams();
  const initialView = parseInitialView(searchParams?.get("view"));
  const initialFilter = parseInitialFilter(searchParams?.get("filter"));
  // Reminders marked done/cancelled are hidden immediately so the action is
  // visible even before router.refresh() re-fetches (and regardless of caching).
  const [completedReminderIds, setCompletedReminderIds] = useState<Set<string>>(() => new Set());
  // The תזכורות tab can show "mine" or (for back-office) "all"; "להיום" is always personal.
  const [reminderScope, setReminderScope] = useState<"mine" | "all">("mine");
  const myReminders = useMemo(
    () => remindersMine.filter((r) => !completedReminderIds.has(r.id)),
    [remindersMine, completedReminderIds]
  );
  const reminders = useMemo(() => {
    const source = reminderScope === "all" && canSeeAll ? remindersAll : remindersMine;
    return source.filter((r) => !completedReminderIds.has(r.id));
  }, [reminderScope, canSeeAll, remindersAll, remindersMine, completedReminderIds]);
  const [view, setView] = useState<View>(initialView);
  const [filter, setFilter] = useState<FilterKey>(initialFilter);
  const [search, setSearch] = useState("");
  const [domain, setDomain] = useState("all");
  const [sort, setSort] = useState<SortKey>("amount");
  const [collectingId, setCollectingId] = useState<string | null>(null);
  const [focusReminderCustomer, setFocusReminderCustomer] = useState<string | null>(null);
  const [addReminderOpen, setAddReminderOpen] = useState(false);
  const [addCallOpen, setAddCallOpen] = useState(false);
  const [editingReminder, setEditingReminder] = useState<Reminder | null>(null);

  // Jump from a debtor row to that customer's reminder in the תזכורות tab.
  function openReminders(customerId: string | null) {
    setFocusReminderCustomer(customerId);
    setView("reminders");
  }

  const domainOptions = useMemo(() => buildDomainOptions(customers), [customers]);
  const filtered = useMemo(
    () => filterAndSortDebtors(customers, { filter, search, domain, sort }),
    [customers, filter, search, domain, sort]
  );
  const overdueReminderCount = reminders.filter((r) => r.remind_at.slice(0, 10) < todayIso()).length;

  function unhideReminder(id: string) {
    setCompletedReminderIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  async function updateReminder(id: string, status: "done" | "cancelled") {
    // Optimistic: hide the reminder immediately, restore it if the server rejects.
    setCompletedReminderIds((prev) => new Set(prev).add(id));
    try {
      const result = await offlineFetch(
        "/api/reminders/update",
        { id, status },
        status === "done" ? "סימון תזכורת כבוצעה" : "ביטול תזכורת"
      );
      if (!result.queued && !result.ok) {
        unhideReminder(id); // rollback
        toast.error(toHebrewError(result.error, "עדכון התזכורת נכשל."));
        return;
      }
      if (!result.queued) {
        toast.success(status === "done" ? "התזכורת סומנה כבוצעה." : "התזכורת בוטלה.");
        router.refresh();
      }
    } catch (err: unknown) {
      unhideReminder(id); // rollback
      toast.error(toHebrewError(err, "עדכון התזכורת נכשל."));
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
      if (!result.queued && result.ok) router.refresh();
    } finally {
      setCollectingId(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* Tabs on the right, quick-action buttons on the left, one row */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60">
        <div className="flex items-center gap-2 sm:gap-3">
          <ViewTab active={view === "activity"} onClick={() => setView("activity")} icon={MessageCircle}>
            יומן שיחות
          </ViewTab>
          <ViewTab active={view === "reminders"} onClick={() => setView("reminders")} icon={Bell}>
            תזכורות{reminders.length ? ` (${reminders.length})` : ""}
            {overdueReminderCount ? (
              <span className="rounded-full bg-destructive px-1.5 text-[10px] text-destructive-foreground">
                {overdueReminderCount}
              </span>
            ) : null}
          </ViewTab>
          <ViewTab active={view === "debtors"} onClick={() => setView("debtors")} icon={Coins}>
            חייבים{totals.customerCount ? ` (${totals.customerCount})` : ""}
          </ViewTab>
        </div>
        <div className="flex flex-wrap gap-2 pb-2">
          <Button type="button" size="sm" onClick={() => setAddCallOpen(true)}>
            <MessageCircle className="me-1 h-4 w-4" />
            תיעוד שיחה
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setAddReminderOpen(true)}>
            <Bell className="me-1 h-4 w-4" />
            הוספת תזכורת
          </Button>
        </div>
      </div>

      <AddCollectionEntryDialog
        mode="reminder"
        open={addReminderOpen}
        onOpenChange={setAddReminderOpen}
        onSaved={() => router.refresh()}
      />
      <AddCollectionEntryDialog
        mode="call"
        open={addCallOpen}
        onOpenChange={setAddCallOpen}
        onSaved={() => router.refresh()}
      />

      <EditReminderDialog
        reminder={editingReminder}
        open={Boolean(editingReminder)}
        onOpenChange={(o) => {
          if (!o) setEditingReminder(null);
        }}
        onSaved={() => router.refresh()}
      />

      {/* להיום — always personal: my reminders due + payments to collect now */}
      <TodayOverview
        reminders={myReminders}
        dueToday={dueToday}
        collectingId={collectingId}
        onCollect={markCollected}
        onUpdateReminder={updateReminder}
      />

      {view === "activity" ? (
        <ActivityView logs={recentLogs} onChanged={() => router.refresh()} />
      ) : view === "reminders" ? (
        <div className="space-y-3">
          {canSeeAll ? (
            <div className="flex w-fit rounded-xl border bg-secondary/40 p-0.5 text-sm">
              <button
                type="button"
                onClick={() => setReminderScope("mine")}
                className={`rounded-lg px-3 py-1 transition-colors ${
                  reminderScope === "mine"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-secondary/10"
                }`}
              >
                שלי
              </button>
              <button
                type="button"
                onClick={() => setReminderScope("all")}
                className={`rounded-lg px-3 py-1 transition-colors ${
                  reminderScope === "all"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-secondary/10"
                }`}
              >
                הכל
              </button>
            </div>
          ) : null}
          <RemindersView
            reminders={reminders}
            onUpdate={updateReminder}
            onEdit={setEditingReminder}
            focusCustomerId={focusReminderCustomer}
          />
        </div>
      ) : (
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
          onOpenReminders={openReminders}
        />
      )}
    </div>
  );
}

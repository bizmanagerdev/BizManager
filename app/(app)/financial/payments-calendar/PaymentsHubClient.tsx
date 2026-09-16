"use client";

import { useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { AddDateIcon, AddIcon, CalculatorIcon, CalendarIcon, RecurringIcon, WarningIcon } from "@/components/ui/icons";
import { useBackfillMissing } from "@/app/(app)/financial/useBackfillMissing";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { replaceSearchParams } from "@/lib/ui/url-state";
import type { PaymentCalendarItem } from "@/lib/payables";
import type { Account } from "@/lib/accounts";
import RecurringExpensesManager, {
  type RecurringExpenseTemplateItem,
} from "@/app/(app)/financial/RecurringExpensesManager";
import PaymentsCalendar, { CashNeedsDialog } from "./PaymentsCalendar";
import type { OutflowSourceSettingsRecord } from "@/lib/outflow-source-settings";

const ExpenseDialog = dynamic(
  () => import("@/components/expenses/ExpenseDialog").then((mod) => mod.ExpenseDialog),
  { loading: () => null }
);

type Option = { id: string; label: string };

type Props = {
  items: PaymentCalendarItem[];
  todayIso: string;
  templates: RecurringExpenseTemplateItem[];
  projects: Option[];
  properties: Option[];
  orders: Option[];
  accounts: Account[];
  // Per-source settings (alert days, account, active) for the salaries / loans /
  // cards on the board — the alerts bar needs them; the tab loads its own rows.
  sourceSettings: OutflowSourceSettingsRecord;
  expenseMissingSchema: boolean;
  // Set when this load's recurring-expense generator failed — the board may be
  // missing this month's bills, and the user must know that rather than trust it.
  generatorError?: string | null;
};

const TABS = [
  // The board itself.
  { key: "calendar", label: "לוח תשלומים", icon: CalendarIcon },
  // What feeds it: bills AND the other fixed outflows (salaries, loans, cards),
  // one list by day with each one's rules — named for what it answers.
  { key: "recurring", label: "פירוט", icon: RecurringIcon },
] as const;

type TabKey = (typeof TABS)[number]["key"];

// The active tab lives in the URL (`?tab=recurring`; the calendar is the
// default and writes nothing) so a refresh, or Back from a source page, returns
// to the tab the user was on.
const TAB_PARAM = "tab";
function tabFromParam(value: string | null): TabKey {
  return value === "recurring" ? "recurring" : "calendar";
}

// The יומן תשלומים hub: a calendar/list of upcoming payments + management of the
// recurring-expense templates that feed it.
export default function PaymentsHubClient({
  items,
  todayIso,
  templates,
  projects,
  properties,
  orders,
  accounts,
  sourceSettings,
  expenseMissingSchema,
  generatorError = null,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [activeTab, setActiveTab] = useState<TabKey>(() => tabFromParam(searchParams.get(TAB_PARAM)));
  const changeTab = (next: TabKey) => {
    setActiveTab(next);
    replaceSearchParams({ [TAB_PARAM]: next === "calendar" ? null : next });
  };
  const [newTemplateOpen, setNewTemplateOpen] = useState(false);
  const [cashOpen, setCashOpen] = useState(false);
  // "השלמת חיובים חסרים" for every template — lives up here beside "new", not
  // buried above the list.
  const backfill = useBackfillMissing();

  return (
    <Tabs dir="rtl" value={activeTab} onValueChange={(value) => changeTab(tabFromParam(value))} className="space-y-4">
      {generatorError ? (
        <div role="status" className="flex items-center gap-2 rounded-xl border border-warning/40 bg-warning/[0.05] px-3 py-2 text-sm text-warning-strong">
          <WarningIcon className="h-4 w-4 shrink-0" />
          <span>ההוצאות הקבועות של החודש לא נוצרו בטעינה זו — הלוח עלול להיות חסר. {generatorError}</span>
        </div>
      ) : null}
      {/* Header — tab bar + the actions for the active tab, on one baseline */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <TabsList variant="underline" className="w-auto">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <TabsTrigger key={tab.key} value={tab.key}>
                <Icon className="h-4 w-4" />
                {tab.label}
              </TabsTrigger>
            );
          })}
        </TabsList>
        <div className="flex flex-wrap items-center gap-2">
          {/* The cash-needs calculator is useful from either tab. */}
          <Button type="button" size="sm" variant="secondary" onClick={() => setCashOpen(true)}>
            <CalculatorIcon className="h-4 w-4" />
            כמה צריך?
          </Button>
          {/* The calendar tab has no generic "הוסף תשלום" — a one-off payment is
              "הוצאה" in the app's one quick-create +. The calendar's own per-day
              add stays: it carries the day you clicked. */}
          {activeTab === "recurring" ? (
            <>
              {/* No "create current cycle" button: the generator runs on every
                  page load (memoized for a minute) and walks every period from
                  each bill's start date. "השלמת חיובים חסרים" on the list is the
                  explicit action, with a preview. */}
              <Button type="button" size="sm" onClick={() => setNewTemplateOpen(true)} disabled={expenseMissingSchema}>
                <AddIcon className="h-4 w-4" />
                הוצאה קבועה חדשה
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void backfill.open({ id: null, label: "כל ההוצאות הקבועות" })}
                disabled={expenseMissingSchema}
              >
                <AddDateIcon className="h-4 w-4" />
                השלמת חיובים חסרים
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <TabsContent value="calendar">
        <PaymentsCalendar
          items={items}
          todayIso={todayIso}
          projects={projects}
          properties={properties}
          orders={orders}
          accounts={accounts}
          templates={templates}
          sourceSettings={sourceSettings}
        />
      </TabsContent>
      <TabsContent value="recurring">
        <RecurringExpensesManager
          templates={templates}
          projects={projects}
          properties={properties}
          orders={orders}
          accounts={accounts}
          missingSchema={expenseMissingSchema}
        />
      </TabsContent>

      {/* Cash-needs calculator (both tabs) — "how much will I need between X and Y?" */}
      <CashNeedsDialog
        key={cashOpen ? "cash-open" : "cash-closed"}
        open={cashOpen}
        onOpenChange={setCashOpen}
        items={items}
        accounts={accounts}
        todayIso={todayIso}
      />

      {backfill.dialog}

      {/* New recurring template (recurring tab) — opens in recurring mode */}
      <ExpenseDialog
        open={newTemplateOpen}
        onOpenChange={setNewTemplateOpen}
        defaultRecurring
        recurringProjects={projects}
        recurringOrders={orders}
        recurringProperties={properties}
        onSaved={() => {
          setNewTemplateOpen(false);
          startTransition(() => {
            router.refresh();
          });
        }}
      />
    </Tabs>
  );
}

"use client";

import { useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { AddDateIcon, AddIcon, CalculatorIcon, CalendarIcon, RecurringIcon, WarningIcon } from "@/components/ui/icons";
import { useBackfillMissing } from "@/app/(app)/financial/useBackfillMissing";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FOCUS_PARAM } from "@/components/layout/FocusHighlighter";
import { replaceSearchParams } from "@/lib/ui/url-state";
import { DIRECTION_OPTIONS, DIRECTION_PARAM, directionFromParam, type DirectionFilter, type IncomeOptions } from "./calendar.helpers";
import type { PaymentCalendarItem } from "@/lib/payables";
import type { Account } from "@/lib/accounts";
import RecurringExpensesManager, {
  type RecurringExpenseTemplateItem,
} from "@/app/(app)/financial/RecurringExpensesManager";
import PaymentsCalendar, { CashNeedsDialog } from "./PaymentsCalendar";

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
  /** Pickers for recording a receipt from a day (the income dialog's shapes). */
  incomeOptions: IncomeOptions;
  expenseMissingSchema: boolean;
  // Set when this load's recurring-expense generator failed — the board may be
  // missing this month's bills, and the user must know that rather than trust it.
  generatorError?: string | null;
};

const TABS = [
  // The board itself. Named for the flow, not a direction: it carries money
  // going out AND coming in.
  { key: "calendar", label: "לוח תזרים", icon: CalendarIcon },
  // Everything that repeats, in whichever direction the switch shows: bills,
  // salaries, loans and cards going out; rent, loans given and the card
  // settlement coming in. Not a detail view of the calendar but its own thing,
  // with its own summary and add button. "קבועות" rather than
  // "התחייבויות קבועות", because in נכנס it lists rent — income, not an
  // obligation. The key stays "recurring" so ?tab=recurring links still work.
  { key: "recurring", label: "קבועות", icon: RecurringIcon },
] as const;

type TabKey = (typeof TABS)[number]["key"];

// The active tab lives in the URL (`?tab=recurring`; the calendar is the
// default and writes nothing) so a refresh, or Back from a source page, returns
// to the tab the user was on.
const TAB_PARAM = "tab";
function tabFromParam(value: string | null): TabKey {
  return value === "recurring" ? "recurring" : "calendar";
}

// The צפי תזרים hub: scheduled money in both directions, as a calendar (לוח תזרים)
// and as the list of what repeats (קבועות).
export default function PaymentsHubClient({
  items,
  todayIso,
  templates,
  projects,
  properties,
  orders,
  accounts,
  incomeOptions,
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
  // Which way the money goes. Lives in the URL like the tab and the month, so a
  // refresh or Back from a source page comes back to the same side of the
  // ledger. Outgoing is the default and writes nothing.
  //
  // A `?focus=<item id>` deep link (an alert, a "go to source" link) has to land
  // ON its item — and an incoming item is not on the outgoing board at all. So
  // when the URL asks to focus something and does NOT say which direction, the
  // focused item's own direction wins over the default.
  const [direction, setDirection] = useState<DirectionFilter>(() => {
    const explicit = searchParams.get(DIRECTION_PARAM);
    if (explicit) return directionFromParam(explicit);
    const focusId = searchParams.get(FOCUS_PARAM);
    const focused = focusId ? items.find((i) => i.id === focusId) : null;
    return focused ? focused.direction : "out";
  });
  const changeDirection = (next: DirectionFilter) => {
    setDirection(next);
    replaceSearchParams({ [DIRECTION_PARAM]: next === "out" ? null : next });
  };
  const [newTemplateOpen, setNewTemplateOpen] = useState(false);
  const [cashOpen, setCashOpen] = useState(false);
  // Header spot the calendar portals its alerts chip into — the chip needs the
  // calendar's account filter, so it stays owned there but reads up here.
  const [alertsSlot, setAlertsSlot] = useState<HTMLDivElement | null>(null);
  // Where the board's data filters render — beside the mode switcher, since
  // they do the same kind of thing.
  const [filtersSlot, setFiltersSlot] = useState<HTMLDivElement | null>(null);
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
        {/* The tabs and the direction switch are one fixed cluster. Both frame
            everything below them and apply to both tabs, and — the reason
            they are here together — neither ever changes width. The switch
            used to sit at the moving edge of the controls group, so every
            click that showed or hid a filter (רק קבועות is meaningless in
            נכנס) or relabelled the overdue chip shoved it sideways, right
            under the pointer of someone clicking through the three options. */}
        <div className="flex flex-wrap items-center gap-3">
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
          {/* Out / in / both. A segmented control, not three chips: these are
              mutually exclusive views of the same board. */}
          <div role="group" aria-label="כיוון הכסף" className="inline-flex h-[34px] overflow-hidden rounded-lg border border-input">
            {DIRECTION_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                aria-pressed={direction === opt.value}
                onClick={() => changeDirection(opt.value)}
                className={`px-3 text-xs font-semibold transition-colors ${
                  direction === opt.value
                    ? "bg-secondary text-secondary-foreground"
                    : "bg-background text-muted-foreground hover:bg-secondary/5 hover:text-foreground"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        {/* Everything whose width depends on the direction or the tab lives
            here, on the far side, where growing and shrinking moves nothing
            the user is aiming at. */}
        <div className="flex flex-wrap items-center gap-2">
          {activeTab === "calendar" ? <div ref={setFiltersSlot} className="contents" /> : null}
          {activeTab === "calendar" ? <div ref={setAlertsSlot} className="contents" /> : null}
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
          incomeOptions={incomeOptions}
          alertsSlot={alertsSlot}
          filtersSlot={filtersSlot}
          direction={direction}
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
          direction={direction}
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
        direction={direction}
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

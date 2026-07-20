"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarDays, Repeat, Plus, RotateCw, Calculator } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toHebrewError } from "@/lib/error-messages";
import type { PaymentCalendarItem } from "@/lib/payables";
import type { Account } from "@/lib/accounts";
import { ExpenseDialog } from "@/components/expenses/ExpenseDialog";
import RecurringExpensesManager, {
  type RecurringExpenseTemplateItem,
} from "@/app/(app)/financial/RecurringExpensesManager";
import PaymentsCalendar, { CashNeedsDialog } from "./PaymentsCalendar";

type Option = { id: string; label: string };

type Props = {
  items: PaymentCalendarItem[];
  todayIso: string;
  templates: RecurringExpenseTemplateItem[];
  projects: Option[];
  properties: Option[];
  orders: Option[];
  accounts: Account[];
  expenseMissingSchema: boolean;
};

const TABS = [
  { key: "calendar", label: "תשלומים", icon: CalendarDays },
  { key: "recurring", label: "הוצאות קבועות", icon: Repeat },
] as const;

type TabKey = (typeof TABS)[number]["key"];

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
  expenseMissingSchema,
}: Props) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabKey>("calendar");
  const [addOpen, setAddOpen] = useState(false);
  const [newTemplateOpen, setNewTemplateOpen] = useState(false);
  const [cashOpen, setCashOpen] = useState(false);
  const [generating, setGenerating] = useState(false);

  async function generateCycle() {
    setGenerating(true);
    try {
      const res = await fetch("/api/recurring-expenses/generate", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error("שגיאה ביצירת הוצאות קבועות", { description: toHebrewError(json?.error, "") });
        return;
      }
      router.refresh();
      toast.success("המחזור נוצר", {
        description: `נוצרו ${typeof json?.createdCount === "number" ? json.createdCount : 0} הוצאות.`,
      });
    } finally {
      setGenerating(false);
    }
  }

  return (
    <Tabs dir="rtl" value={activeTab} onValueChange={(value) => setActiveTab(value as TabKey)} className="space-y-4">
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
          {activeTab === "calendar" ? (
            <>
              <Button type="button" size="sm" variant="secondary" onClick={() => setCashOpen(true)}>
                <Calculator className="ml-1 h-4 w-4" />
                כמה צריך?
              </Button>
              <Button type="button" size="sm" onClick={() => setAddOpen(true)}>
                <Plus className="ml-1 h-4 w-4" />
                הוסף תשלום
              </Button>
            </>
          ) : (
            <>
              <Button type="button" size="sm" onClick={() => setNewTemplateOpen(true)} disabled={expenseMissingSchema}>
                <Plus className="ml-1 h-4 w-4" />
                הוצאה קבועה חדשה
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => void generateCycle()} disabled={generating || expenseMissingSchema}>
                <RotateCw className={`ml-1 h-4 w-4 ${generating ? "animate-spin" : ""}`} />
                {generating ? "מייצר..." : "צור מחזור נוכחי"}
              </Button>
            </>
          )}
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

      {/* Cash-needs calculator (calendar tab) — "how much will I need between X and Y?" */}
      <CashNeedsDialog
        key={cashOpen ? "cash-open" : "cash-closed"}
        open={cashOpen}
        onOpenChange={setCashOpen}
        items={items}
        accounts={accounts}
        todayIso={todayIso}
      />

      {/* Global quick-add payment (calendar tab) — defaults to today */}
      <ExpenseDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        defaultDate={todayIso}
        showAttachments
        recurringProjects={projects}
        recurringOrders={orders}
        recurringProperties={properties}
        onSaved={() => {
          setAddOpen(false);
          router.refresh();
        }}
      />

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
          router.refresh();
        }}
      />
    </Tabs>
  );
}

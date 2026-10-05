"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BankIcon, ReportIcon, WalletIcon, WarningIcon } from "@/components/ui/icons";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FOCUS_PARAM } from "@/components/layout/FocusHighlighter";
import { replaceSearchParams } from "@/lib/ui/url-state";
import type { DebtItem } from "@/lib/debts";
import type { Loan, LoansSummary } from "@/lib/loans";
import DebtsList from "./DebtsList";
import DebtsReport from "./DebtsReport";
import LoansClient from "./LoansClient";
import { DEBTS_TAB_PARAM, debtsTabItems, initialDebtsTab, type DebtsTab } from "./debts.helpers";

const TABS: Array<{ key: DebtsTab; label: string; icon: typeof WalletIcon }> = [
  // What we owe that isn't a loan — unpaid expenses and wages, by kind. The
  // page's reason to exist, so it leads.
  { key: "debts", label: "חובות", icon: WalletIcon },
  // The loans themselves, managed as before (new loan, repayments, documents).
  { key: "loans", label: "הלוואות", icon: BankIcon },
  // Every debt, loans included, totalled every useful way.
  { key: "report", label: "דוח", icon: ReportIcon },
];

// The חובות page: what the business owes. The tab lives in the URL (`?tab=`;
// the debts list is the default and writes nothing) so a refresh, or Back from
// a project / loan, returns to the same tab.
export default function DebtsHubClient({
  items,
  todayIso,
  errors,
  loans,
  loansSummary,
  accounts,
}: {
  items: DebtItem[];
  todayIso: string;
  errors: string[];
  loans: Loan[];
  loansSummary: LoansSummary;
  accounts: Array<{ id: string; name: string }>;
}) {
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<DebtsTab>(() =>
    initialDebtsTab(
      {
        tab: searchParams?.get(DEBTS_TAB_PARAM) ?? null,
        repay: searchParams?.get("repay") ?? null,
        focus: searchParams?.get(FOCUS_PARAM) ?? null,
      },
      new Set(loans.map((l) => l.id))
    )
  );
  const changeTab = (next: DebtsTab) => {
    setActiveTab(next);
    replaceSearchParams({ [DEBTS_TAB_PARAM]: next === "debts" ? null : next });
  };

  const debtsListItems = useMemo(() => debtsTabItems(items), [items]);
  const accountNames = useMemo(() => new Map(accounts.map((a) => [a.id, a.name] as const)), [accounts]);
  const openLoanCount = loansSummary.borrowedActiveCount + loansSummary.lentActiveCount;

  return (
    <Tabs dir="rtl" value={activeTab} onValueChange={(value) => changeTab(value as DebtsTab)} className="space-y-4 text-right">
      <TabsList variant="underline">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const count = tab.key === "debts" ? debtsListItems.length : tab.key === "loans" ? openLoanCount : undefined;
          return (
            <TabsTrigger key={tab.key} value={tab.key} count={count}>
              <Icon className="h-4 w-4" />
              {tab.label}
            </TabsTrigger>
          );
        })}
      </TabsList>

      {errors.length > 0 && activeTab !== "loans" ? (
        <div role="status" className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/[0.05] px-3 py-2 text-sm text-warning-strong">
          <WarningIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            {errors.map((e) => (
              <div key={e}>{e} הסכומים בדף חסרים את החלק הזה — רעננו את הדף כדי לנסות שוב.</div>
            ))}
          </div>
        </div>
      ) : null}

      <TabsContent value="debts" className="mt-0">
        <DebtsList items={debtsListItems} todayIso={todayIso} />
      </TabsContent>
      <TabsContent value="loans" className="mt-0">
        <LoansClient loans={loans} summary={loansSummary} />
      </TabsContent>
      <TabsContent value="report" className="mt-0">
        <DebtsReport items={items} todayIso={todayIso} accountNames={accountNames} />
      </TabsContent>
    </Tabs>
  );
}

"use client";

import type { ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { BankIcon, ExpenseIcon, LaborIcon, ListIcon, ReportIcon, WalletIcon } from "@/components/ui/icons";
import { ResponsiveDataView } from "@/components/ui/responsive-data-view";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AdaptiveGrid } from "@/components/layout/page-layout";
import { TextLineSkeleton, UnderlineTabsSkeleton } from "@/components/layout/loading-skeletons";
import { DEBT_KIND_LABEL, DEBT_TIMING_LABEL } from "@/lib/debts";
import { ButtonSkeleton } from "@/app/(app)/financial/ButtonSkeleton";
import { DEBTS_TAB_PARAM, type DebtsTab } from "./debts.helpers";

// The חובות page before its data, from DebtsHubClient's tab bar (the open tab
// from the address, as the page picks it) and that tab's own classes: the
// debts list — totals line, search and filters (a search and a filter button
// on a phone), the kind sections with their table from md and cards below it;
// the loans — the new-loan button, the three boxes, the filter buttons, the
// loan cards; the report — its filters, the five summary cards, the box with
// its view switch. Shown while the page streams (loading.tsx).

function tabOf(params: URLSearchParams | null): DebtsTab {
  const tab = params?.get(DEBTS_TAB_PARAM);
  if (tab === "loans" || tab === "report" || tab === "debts") return tab;
  // A repayment deep link (?repay=) can only land on the loans tab.
  return params?.get("repay") ? "loans" : "debts";
}

const TAB_INDEX: Record<DebtsTab, number> = { debts: 0, loans: 1, report: 2 };

const DEBT_COLUMNS = ["פריט", "שייך ל", "מועד", "סטטוס", "נשאר לשלם", "פעולות"];

// One kind's section (DebtsList.ui's KindSection): its header, then the
// table from md and the cards below it.
function KindSectionSkeleton({ icon, label, rows }: { icon: ReactNode; label: string; rows: number }) {
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="text-sm font-semibold">{label}</h2>
          <Skeleton className="h-[1.125rem] w-7 rounded-full" />
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">סה״כ</span>
          <TextLineSkeleton barClassName="w-16" />
        </div>
      </div>
      <ResponsiveDataView
        breakpoint="md"
        desktop={
          <div className="overflow-hidden rounded-2xl border border-border/70">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead className="bg-muted">
                <tr className="border-b border-border/70 text-xs text-muted-foreground">
                  {DEBT_COLUMNS.map((column, i) => (
                    <th
                      key={column}
                      className={
                        i === 0
                          ? "w-[30%] px-3 py-2 text-right font-medium"
                          : i === 4
                            ? "px-3 py-2 text-end font-medium"
                            : i === 5
                              ? "px-2 py-2 text-end font-medium"
                              : "px-3 py-2 text-right font-medium"
                      }
                    >
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: rows }).map((_, row) => (
                  <tr key={row} className="h-[3.5rem] border-b border-border/50 align-top">
                    {DEBT_COLUMNS.map((column, cell) => (
                      <td key={column} className={cell === 5 ? "px-2 py-2.5" : "px-3 py-2.5"}>
                        <Skeleton className={cell === 0 ? "h-4 w-4/5" : "h-4 w-3/5"} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        }
        mobile={
          <div className="space-y-2">
            {Array.from({ length: rows }).map((_, i) => (
              <div key={i} className="rounded-2xl border border-border/70 bg-background/60 p-3">
                <div className="flex items-start justify-between gap-2 text-right">
                  <div className="min-w-0 space-y-1">
                    <TextLineSkeleton className="font-semibold" barClassName="w-36" />
                    <TextLineSkeleton className="text-xs" barClassName="w-28" />
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <TextLineSkeleton className="text-lg" barClassName="w-16" />
                    <Skeleton className="h-6 w-14 rounded-full" />
                    <TextLineSkeleton className="text-xs" barClassName="w-12" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        }
      />
    </section>
  );
}

// The חובות tab (DebtsList): totals line, filters, the kind sections.
function DebtsTabSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        {["סה״כ חובות", DEBT_TIMING_LABEL.overdue, DEBT_TIMING_LABEL.soon].map((label, i) => (
          <span key={label} className="whitespace-nowrap">
            {i > 0 ? <span className="text-border">· </span> : null}
            <span className="text-muted-foreground">{label}</span>{" "}
            <Skeleton className="inline-block h-[0.75em] w-14 align-middle" />
          </span>
        ))}
      </div>
      <div className="hidden items-center gap-2 sm:flex sm:flex-wrap">
        <Skeleton className="h-9 w-64 rounded-xl" />
        <Skeleton className="h-9 w-28 rounded-lg" />
        <Skeleton className="h-9 w-32 rounded-lg" />
      </div>
      <div className="relative sm:hidden">
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 flex-1 rounded-xl" />
          <Skeleton className="h-9 w-9 shrink-0 rounded-xl" />
        </div>
      </div>
      <div className="space-y-6">
        <KindSectionSkeleton icon={<ExpenseIcon className="h-4 w-4 text-primary" />} label={DEBT_KIND_LABEL.expense} rows={5} />
        <KindSectionSkeleton icon={<LaborIcon className="h-4 w-4 text-primary" />} label={DEBT_KIND_LABEL.wages} rows={2} />
      </div>
    </div>
  );
}

// The הלוואות tab (LoansClient): new loan, the three boxes, the filters, the loans.
function LoansTabSkeleton() {
  return (
    <div className="space-y-4 text-right">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <ButtonSkeleton label="הלוואה חדשה" icon />
      </div>
      <AdaptiveGrid variant="customerStats">
        {["חוב הלוואות (שלקחתי)", "הלוואות שנתתי (חייבים לי)", "מאזן הלוואות (נטו)"].map((label) => (
          <div key={label} className="rounded-md border bg-background p-3">
            <div className="text-xs text-muted-foreground">{label}</div>
            <TextLineSkeleton className="mt-0.5 text-xl font-semibold" barClassName="w-24" />
          </div>
        ))}
      </AdaptiveGrid>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <ButtonSkeleton label="הכל" size="sm" />
          <ButtonSkeleton label="שלקחתי" size="sm" />
          <ButtonSkeleton label="שנתתי" size="sm" />
        </div>
      </div>
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="flex flex-col gap-3 p-3 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <TextLineSkeleton className="font-semibold" barClassName="w-28" />
                  <Skeleton className="h-6 w-14 rounded-md" />
                  <Skeleton className="h-6 w-16 rounded-md" />
                </div>
                <TextLineSkeleton className="text-sm" barClassName="w-40" />
                <TextLineSkeleton className="text-sm" barClassName="w-64 max-w-full" />
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <ButtonSkeleton label="פרטים" size="sm" icon />
                <ButtonSkeleton label="החזרים (0/0)" size="sm" icon />
                <ButtonSkeleton label="מסמכים" size="sm" icon />
                <Skeleton className="h-9 w-9 shrink-0 rounded-xl" />
                <Skeleton className="h-9 w-9 shrink-0 rounded-xl" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

const REPORT_CARDS = [
  { title: "סה״כ חובות", description: null },
  { title: DEBT_TIMING_LABEL.overdue, description: "עבר המועד ועדיין לא שולם" },
  { title: DEBT_TIMING_LABEL.soon, description: null },
  { title: DEBT_TIMING_LABEL.later, description: "מעבר לשבוע הקרוב" },
  { title: DEBT_TIMING_LABEL.undated, description: "לא נקבע מתי לשלם" },
];

// The דוח tab (DebtsReport): filters, the five cards, the box.
function ReportTabSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center">
        <Skeleton className="h-9 w-full rounded-lg sm:w-40" />
        <Skeleton className="h-9 w-full rounded-lg sm:w-32" />
        <Skeleton className="h-9 w-full rounded-lg sm:w-32" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {REPORT_CARDS.map((card, i) => (
          <Card key={card.title} className={i === 0 ? "overflow-hidden border-secondary ring-2 ring-secondary/30" : "overflow-hidden"}>
            <div className="p-5 text-right">
              <div className="text-sm text-muted-foreground">{card.title}</div>
              <TextLineSkeleton className="mt-2 text-2xl font-semibold" barClassName="w-24" />
              {card.description ? (
                <div className="mt-1 text-xs text-muted-foreground">{card.description}</div>
              ) : (
                <TextLineSkeleton className="mt-1 text-xs" barClassName="w-20" />
              )}
            </div>
          </Card>
        ))}
      </div>
      {/* SectionCard's shell — its title carries the count and the sum, so it's built here. */}
      <section className="scroll-mt-24 space-y-3 rounded-3xl border border-border/70 bg-card/80 p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-primary">
              <ListIcon className="h-4 w-4" />
            </span>
            <h2 className="text-sm font-semibold">
              כל החובות — <Skeleton className="inline-block h-[0.75em] w-24 align-middle" />
            </h2>
          </div>
        </div>
        <Tabs dir="rtl" value="list">
          <TabsList>
            {["פירוט", "סוג", "חודש", "חשבון", "תחום"].map((label, i) => (
              <TabsTrigger key={label} value={i === 0 ? "list" : label}>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="mt-3 space-y-6">
            <KindSectionSkeleton icon={<ExpenseIcon className="h-4 w-4 text-primary" />} label={DEBT_KIND_LABEL.expense} rows={4} />
            <KindSectionSkeleton icon={<BankIcon className="h-4 w-4 text-primary" />} label={DEBT_KIND_LABEL.loan} rows={2} />
          </div>
        </Tabs>
      </section>
    </div>
  );
}

export default function DebtsSkeleton() {
  const tab = tabOf(useSearchParams());
  return (
    <div className="space-y-4 text-right" dir="rtl" data-route-loading="true" aria-busy="true">
      <UnderlineTabsSkeleton
        labels={[
          <>
            <WalletIcon className="h-4 w-4" />
            חובות
          </>,
          <>
            <BankIcon className="h-4 w-4" />
            הלוואות
          </>,
          <>
            <ReportIcon className="h-4 w-4" />
            דוח
          </>,
        ]}
        active={TAB_INDEX[tab]}
        counts={[true, true, false]}
      />
      {tab === "loans" ? <LoansTabSkeleton /> : tab === "report" ? <ReportTabSkeleton /> : <DebtsTabSkeleton />}
    </div>
  );
}

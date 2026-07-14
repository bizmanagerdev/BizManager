"use client";

import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ProfitLossDomainRow } from "@/lib/financial";
import type { EarnedRevenueReport } from "@/lib/financial/earnedRevenue";
import type { DomainProofMap, DomainProofItem } from "@/lib/financial/domainProof";
import type { ProjectBreakdown } from "@/lib/financial/projectBreakdown";

// "cash"    = money that actually moved this period (came in / went out).
// "earned"  = money I MADE this period — booked to the month the work/sale
//             happened, even if the cash comes in later (from the earned report).
// "accrual" = cash + open debts owed to/by me.
// The basis + includePersonal are chosen globally (top control row) and passed in.
type Basis = "cash" | "earned" | "accrual";

const PROJECTS_DOMAIN = "logistics_projects";

const BASIS_HINT: Record<Basis, string> = {
  cash: "לפי כסף שבאמת נכנס/יצא מהחשבונות בתקופה",
  earned: "לפי מה שהרווחתי בתקופה — גם אם עדיין לא נגבה",
  accrual: "בפועל בתוספת חובות פתוחים (מגיע לי / אני חייב)",
};

const currencyFormatter = new Intl.NumberFormat("he-IL", {
  style: "currency",
  currency: "ILS",
  maximumFractionDigits: 0,
});
function formatCurrency(value: number) {
  return currencyFormatter.format(Math.round(value));
}
function signed(value: number) {
  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : rounded < 0 ? "−" : ""}${formatCurrency(Math.abs(rounded))}`;
}
function netClass(value: number) {
  if (value > 0.5) return "text-success";
  if (value < -0.5) return "text-destructive";
  return "text-foreground";
}
function dayMonth(date: string | null) {
  return date ? `${date.slice(8, 10)}/${date.slice(5, 7)}` : "—";
}

type Row = { name: string; net: number; domain: string };

// The income/expense items that PROVE a single row's number, for the expandable
// detail. Non-project domains come from the domain proof; פרויקטים is rebuilt from
// the per-project breakdown (earnedShare = income, periodExpenses = expense).
type RowDetail = {
  income: DomainProofItem[];
  expenses: DomainProofItem[];
  incomeTotal: number;
  expenseTotal: number;
};

/**
 * Reports → סקירה: a waterfall "x + y − z = ?" of the whole business.
 *   רווח מכל העסקים (מכירות + פרויקטים + הכנסות אחרות)
 *     − שוטף (תקורה כללית)
 *     − בית / צדקה (אישי)
 *     = מה שנשאר בסוף
 * Each stage shows its contribution and the running "כמה נשאר" after it.
 * Every business/overhead row is CLICKABLE — it opens to the exact transactions
 * behind the number (what I earned / what I spent), from the same proof data the
 * לפי תחום tab uses. The proof is earned-basis, so the detail ties to the row
 * only in "הרווחתי" mode; in other modes the rows stay flat.
 */
export default function BottomLinePanel({
  rows,
  earned,
  basis,
  includePersonal,
  domainProof,
  projectBreakdown,
}: {
  rows: ProfitLossDomainRow[];
  earned: EarnedRevenueReport | null;
  basis: Basis;
  includePersonal: boolean;
  domainProof?: DomainProofMap | null;
  projectBreakdown?: ProjectBreakdown | null;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const groups = useMemo(() => {
    // Personal (home/charity) is money spent — always actual, from the P&L rows.
    // Only counted when the global "כולל בית וצדקה" toggle is on.
    const personal: Row[] = includePersonal
      ? rows
          .filter((r) => r.isPersonal)
          .map((r) => ({ name: r.domainName, net: r.cashRevenue - r.cashExpense, domain: r.domain ?? "" }))
          .filter((r) => Math.round(r.net) !== 0)
      : [];

    if (basis === "earned" && earned) {
      const cell = (key: string) => earned.totals.byDomain[key];
      const business: Row[] = earned.domains
        .filter((d) => d.key !== "general_business")
        .map((d) => ({ name: d.label, net: cell(d.key)?.net ?? 0, domain: d.key }))
        .filter((r) => Math.round(r.net) !== 0);
      const overhead: Row[] = earned.domains
        .filter((d) => d.key === "general_business")
        .map((d) => ({ name: d.label, net: cell(d.key)?.net ?? 0, domain: d.key }));
      return { business, overhead, personal };
    }

    const net = (r: ProfitLossDomainRow) =>
      basis === "accrual" ? r.accrualRevenue - r.accrualExpense : r.cashRevenue - r.cashExpense;
    const business: Row[] = rows
      .filter((r) => !r.isPersonal && r.domain !== "general_business")
      .map((r) => ({ name: r.domainName, net: net(r), domain: r.domain ?? "" }))
      .filter((r) => Math.round(r.net) !== 0);
    const overhead: Row[] = rows
      .filter((r) => r.domain === "general_business")
      .map((r) => ({ name: r.domainName, net: net(r), domain: r.domain ?? "" }));
    return { business, overhead, personal };
  }, [basis, rows, earned, includePersonal]);

  // Detail is earned-basis (proof data mirrors the earned report), so it only
  // ties to the row numbers in "הרווחתי" mode. Elsewhere, rows stay flat.
  const detailAvailable = basis === "earned";

  const detailFor = useMemo(() => {
    return (domain: string): RowDetail | null => {
      if (!detailAvailable || !domain) return null;
      if (domain === PROJECTS_DOMAIN) {
        if (!projectBreakdown) return null;
        const income: DomainProofItem[] = projectBreakdown.rows
          .filter((r) => Math.round(r.earnedShare) !== 0)
          .map((r) => ({ date: null, label: r.name, amount: r.earnedShare }));
        const expenses: DomainProofItem[] = projectBreakdown.rows
          .filter((r) => Math.round(r.periodExpenses) !== 0)
          .map((r) => ({ date: null, label: r.name, amount: r.periodExpenses }));
        if (Math.round(projectBreakdown.unassignedExpense) !== 0)
          expenses.push({ date: null, label: "הוצאות פרויקטים כלליות (לא שויך)", amount: projectBreakdown.unassignedExpense });
        if (income.length === 0 && expenses.length === 0) return null;
        return {
          income,
          expenses,
          incomeTotal: projectBreakdown.totals.earnedShare,
          expenseTotal: projectBreakdown.domainExpense,
        };
      }
      const proof = domainProof?.[domain];
      if (!proof || (proof.income.length === 0 && proof.expenses.length === 0)) return null;
      return proof;
    };
  }, [detailAvailable, domainProof, projectBreakdown]);

  const businessTotal = groups.business.reduce((sum, r) => sum + r.net, 0);
  const overheadTotal = groups.overhead.reduce((sum, r) => sum + r.net, 0);
  const afterOverhead = businessTotal + overheadTotal;
  const personalTotal = groups.personal.reduce((sum, r) => sum + r.net, 0);
  const finalLeft = afterOverhead + personalTotal;

  const hasData = groups.business.length || groups.overhead.length || groups.personal.length;

  // A single waterfall line. When earned-basis detail exists for the row's domain,
  // it becomes a clickable disclosure that opens the transactions behind the number.
  const line = (label: string, value: number, key: string, domain: string) => {
    const detail = detailFor(domain);
    if (!detail) {
      return (
        <div key={key} className="flex items-center justify-between gap-3 py-1.5">
          <span className="text-sm">{label}</span>
          <span dir="ltr" className={cn("tabular-nums text-sm font-medium", netClass(value))}>{signed(value)}</span>
        </div>
      );
    }
    const isOpen = expanded.has(key);
    return (
      <div key={key}>
        <button
          type="button"
          onClick={() => toggle(key)}
          aria-expanded={isOpen}
          className="flex w-full items-center justify-between gap-3 rounded-md py-1.5 text-right transition-colors hover:bg-muted/60"
        >
          <span className="flex items-center gap-1.5 text-sm">
            <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", isOpen ? "" : "-rotate-90")} />
            {label}
          </span>
          <span dir="ltr" className={cn("tabular-nums text-sm font-medium", netClass(value))}>{signed(value)}</span>
        </button>
        {isOpen ? <DetailBlock detail={detail} /> : null}
      </div>
    );
  };

  const runningRow = (label: string, value: number, key: string) => (
    <div key={key} className="flex items-center justify-between gap-3 border-t border-dashed py-2 mt-1">
      <span className="text-sm font-semibold">{label}</span>
      <span dir="ltr" className={cn("tabular-nums text-base font-bold", netClass(value))}>{formatCurrency(value)}</span>
    </div>
  );

  return (
    <div className="space-y-4 text-right" dir="rtl">
      <p className="text-xs text-muted-foreground print:hidden">{BASIS_HINT[basis]}</p>

      {!hasData ? (
        <div className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
          אין נתונים להצגה עבור התקופה שנבחרה.
        </div>
      ) : (
        <>
          {/* Headline result */}
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="text-right">
                מה שנשאר בסוף {basis === "earned" ? "(לפי מה שהרווחתי)" : basis === "cash" ? "(לפי מה שנכנס)" : "(כולל פתוחים)"}
              </CardDescription>
              <CardTitle className={cn("text-right text-3xl font-bold tabular-nums", netClass(finalLeft))}>
                <span dir="ltr">{formatCurrency(finalLeft)}</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                רווח מהעסקים {formatCurrency(businessTotal)} − שוטף {formatCurrency(-overheadTotal)} − בית/אישי{" "}
                {formatCurrency(-personalTotal)} = {formatCurrency(finalLeft)}
              </p>
            </CardContent>
          </Card>

          {/* Waterfall */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base text-right">שלב אחר שלב — כמה נשאר בכל שלב</CardTitle>
              {detailAvailable ? (
                <CardDescription className="text-right print:hidden">לחצו על שורה כדי לראות בדיוק על מה — מה נכנס ומה יצא.</CardDescription>
              ) : null}
            </CardHeader>
            <CardContent className="divide-y">
              <div className="pb-2">
                <div className="mb-1 text-xs font-medium text-muted-foreground">
                  {basis === "earned" ? "מה שהרווחתי מכל העסקים" : "רווח מכל העסקים"}
                </div>
                {groups.business.length === 0 ? (
                  <div className="py-1.5 text-sm text-muted-foreground">אין פעילות עסקית בתקופה.</div>
                ) : (
                  groups.business
                    .slice()
                    .sort((a, b) => b.net - a.net)
                    .map((r, i) => line(r.name, r.net, `biz-${i}`, r.domain))
                )}
                {runningRow(basis === "earned" ? "סה״כ שהרווחתי" : "רווח מכל העסקים", businessTotal, "__biz_total__")}
              </div>

              {groups.overhead.length > 0 ? (
                <div className="py-2">
                  <div className="mb-1 text-xs font-medium text-muted-foreground">פחות תקורה כללית (שוטף)</div>
                  {groups.overhead.map((r, i) => line(r.name, r.net, `ovh-${i}`, r.domain))}
                  {runningRow("נשאר אחרי שוטף", afterOverhead, "__after_overhead__")}
                </div>
              ) : null}

              {groups.personal.length > 0 ? (
                <div className="pt-2">
                  <div className="mb-1 text-xs font-medium text-muted-foreground">פחות בית ואישי (מה שהמשפחה הוציאה)</div>
                  {groups.personal
                    .slice()
                    .sort((a, b) => a.net - b.net)
                    .map((r, i) => line(r.name, r.net, `per-${i}`, r.domain))}
                </div>
              ) : null}

              <div className="flex items-center justify-between gap-3 border-t-2 pt-3 mt-1">
                <span className="text-base font-bold">מה שנשאר בסוף</span>
                <span dir="ltr" className={cn("tabular-nums text-xl font-bold", netClass(finalLeft))}>
                  {formatCurrency(finalLeft)}
                </span>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

/** The opened detail under a row: income items on one side, expenses on the other. */
function DetailBlock({ detail }: { detail: RowDetail }) {
  const netTotal = detail.incomeTotal - detail.expenseTotal;
  return (
    <div className="mb-2 mt-1 rounded-lg border bg-muted/30 p-3">
      <div className="grid gap-4 md:grid-cols-2">
        <DetailColumn
          title="מה שהרווחתי"
          items={detail.income}
          total={detail.incomeTotal}
          empty="אין הכנסות בתקופה."
          amountClass="text-success"
        />
        <DetailColumn
          title="על מה הוצאתי"
          items={detail.expenses}
          total={detail.expenseTotal}
          empty="אין הוצאות בתקופה."
          amountClass="text-destructive"
        />
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 border-t pt-2 text-sm font-semibold">
        <span>נטו</span>
        <span dir="ltr" className={cn("tabular-nums", netClass(netTotal))}>{formatCurrency(netTotal)}</span>
      </div>
    </div>
  );
}

function DetailColumn({
  title,
  items,
  total,
  empty,
  amountClass,
}: {
  title: string;
  items: DomainProofItem[];
  total: number;
  empty: string;
  amountClass: string;
}) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-muted-foreground">{title}</div>
      {items.length === 0 ? (
        <div className="py-2 text-sm text-muted-foreground">{empty}</div>
      ) : (
        <div className="divide-y">
          {items
            .slice()
            .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
            .map((item, i) => (
              <div key={i} className="flex items-center gap-3 py-1.5 text-sm">
                <span className="w-12 shrink-0 text-xs text-muted-foreground">
                  <span dir="ltr">{dayMonth(item.date)}</span>
                </span>
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                <span dir="ltr" className={cn("shrink-0 tabular-nums font-medium", amountClass)}>{formatCurrency(item.amount)}</span>
              </div>
            ))}
          <div className="flex items-center justify-between gap-3 border-t-2 py-1.5 font-semibold">
            <span className="text-sm">סה״כ</span>
            <span dir="ltr" className={cn("tabular-nums", amountClass)}>{formatCurrency(total)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

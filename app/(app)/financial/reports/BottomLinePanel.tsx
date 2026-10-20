"use client";

import { useMemo, useState } from "react";
import { ChevronDownIcon } from "@/components/ui/icons";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import type { LoanFlowItem, LoanFlows, ProfitLossDomainRow } from "@/lib/financial";
import type { EarnedRevenueReport } from "@/lib/financial/earnedRevenue";
import type { DomainProofMap, DomainProofItem } from "@/lib/financial/domainProof";
import type { ProjectBreakdown } from "@/lib/financial/projectBreakdown";
import type { ProfitLossProofMap } from "@/lib/financial";
import { isPersonalDomain, isPropertyPersonalDomain } from "@/lib/financial/entries";

// "cash"    = money that actually moved this period (came in / went out).
// "earned"  = money I MADE this period — booked to the month the work/sale
//             happened, even if the cash comes in later (from the earned report).
// "accrual" = cash + open debts owed to/by me.
// The basis + includeHomeCharity/includeProperties are chosen globally (top control row) and passed in.
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
 *     + ניהול נכסים (אופציונלי, בטוגל נפרד — חלק ממה שהרווחתי, גם כשהוא במינוס)
 *     − שוטף (תקורה כללית)
 *     − בית / צדקה (אישי, אופציונלי)
 *     ± הלוואות (אופציונלי, "כולל הלוואות" — כסף שנכנס ויצא בפועל, לא רווח)
 *     = מה שנשאר בסוף
 * Each stage shows its contribution and the running "כמה נשאר" after it.
 * Every row is CLICKABLE — it opens to the exact transactions behind the number
 * (what I earned / what I spent). The detail source matches the active basis so it
 * always ties to the row: "הרווחתי" uses the earned proof (domainProof +
 * projectBreakdown); "נכנס בפועל"/"כולל פתוחים" use the cash/accrual line-item
 * proof (profitLossProof). Personal/off-books (home/charity/property_management)
 * rows follow the same basis, each group behind its own toggle.
 */
export default function BottomLinePanel({
  rows,
  earned,
  basis,
  includeHomeCharity,
  includeProperties,
  includeLoans = false,
  loanFlows,
  domainProof,
  projectBreakdown,
  profitLossProof,
}: {
  rows: ProfitLossDomainRow[];
  earned: EarnedRevenueReport | null;
  basis: Basis;
  includeHomeCharity: boolean;
  includeProperties: boolean;
  includeLoans?: boolean;
  loanFlows?: LoanFlows | null;
  domainProof?: DomainProofMap | null;
  projectBreakdown?: ProjectBreakdown | null;
  profitLossProof?: ProfitLossProofMap | null;
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
    // Personal/off-books rows are split into two INDEPENDENT groups, each only
    // counted when its own toggle is on: home/charity, and property_management.
    // They follow the active basis like every other row (owner, 2026-10-13).
    if (basis === "earned" && earned) {
      const cell = (key: string) => earned.totals.byDomain[key];
      const toRow = (d: { key: string; label: string }): Row => ({ name: d.label, net: cell(d.key)?.net ?? 0, domain: d.key });
      const business: Row[] = earned.domains
        .filter((d) => d.key !== "general_business" && !isPersonalDomain(d.key))
        .map(toRow)
        .filter((r) => Math.round(r.net) !== 0);
      const overhead: Row[] = earned.domains.filter((d) => d.key === "general_business").map(toRow);
      const personal = (predicate: (domain: string) => boolean): Row[] =>
        earned.domains
          .filter((d) => isPersonalDomain(d.key) && predicate(d.key))
          .map(toRow)
          .filter((r) => Math.round(r.net) !== 0);
      const homeCharity: Row[] = includeHomeCharity ? personal((d) => !isPropertyPersonalDomain(d)) : [];
      const properties: Row[] = includeProperties ? personal((d) => isPropertyPersonalDomain(d)) : [];
      return { business, overhead, homeCharity, properties };
    }

    const net = (r: ProfitLossDomainRow) =>
      basis === "accrual" ? r.accrualRevenue - r.accrualExpense : r.cashRevenue - r.cashExpense;
    const personalRows = (predicate: (domain: string | null) => boolean): Row[] =>
      rows
        .filter((r) => r.isPersonal && predicate(r.domain))
        .map((r) => ({ name: r.domainName, net: net(r), domain: r.domain ?? "" }))
        .filter((r) => Math.round(r.net) !== 0);
    const homeCharity: Row[] = includeHomeCharity ? personalRows((d) => !isPropertyPersonalDomain(d)) : [];
    const properties: Row[] = includeProperties ? personalRows((d) => isPropertyPersonalDomain(d)) : [];
    const business: Row[] = rows
      .filter((r) => !r.isPersonal && r.domain !== "general_business")
      .map((r) => ({ name: r.domainName, net: net(r), domain: r.domain ?? "" }))
      .filter((r) => Math.round(r.net) !== 0);
    const overhead: Row[] = rows
      .filter((r) => r.domain === "general_business")
      .map((r) => ({ name: r.domainName, net: net(r), domain: r.domain ?? "" }));
    return { business, overhead, homeCharity, properties };
  }, [basis, rows, earned, includeHomeCharity, includeProperties]);

  // Detail for a row, resolved for the panel basis (every row, personal ones too,
  // is computed on it above). Earned → earned proof; cash/accrual → line-item
  // proof. Every path ties to the row because it mirrors the same aggregation.
  const detailFor = useMemo(() => {
    return (domain: string, effectiveBasis: Basis): RowDetail | null => {
      if (!domain || domain === "__unassigned__") return null;

      if (effectiveBasis === "earned") {
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
      }

      // cash / accrual — from the line-item proof, picking that basis's amount.
      const items = profitLossProof?.[domain];
      if (!items || items.length === 0) return null;
      const income: DomainProofItem[] = [];
      const expenses: DomainProofItem[] = [];
      let incomeTotal = 0;
      let expenseTotal = 0;
      for (const item of items) {
        const amount = effectiveBasis === "accrual" ? item.accrual : item.cash;
        if (Math.round(amount) === 0) continue;
        if (item.kind === "income") {
          income.push({ date: item.date, label: item.label, amount });
          incomeTotal += amount;
        } else {
          expenses.push({ date: item.date, label: item.label, amount });
          expenseTotal += amount;
        }
      }
      if (income.length === 0 && expenses.length === 0) return null;
      return { income, expenses, incomeTotal, expenseTotal };
    };
  }, [domainProof, projectBreakdown, profitLossProof]);

  const detailAvailable = basis === "earned" ? !!(domainProof || projectBreakdown) : !!profitLossProof;

  // Order of the steps (owner, 2026-10-13): what the businesses made, then
  // ניהול נכסים (when ticked — part of what I made, even while it's a minus),
  // then שוטף comes off, then בית/צדקה.
  const businessTotal = groups.business.reduce((sum, r) => sum + r.net, 0);
  const propertiesTotal = groups.properties.reduce((sum, r) => sum + r.net, 0);
  const afterProperties = businessTotal + propertiesTotal;
  const overheadTotal = groups.overhead.reduce((sum, r) => sum + r.net, 0);
  const afterOverhead = afterProperties + overheadTotal;
  const homeCharityTotal = groups.homeCharity.reduce((sum, r) => sum + r.net, 0);
  const beforeLoans = afterOverhead + homeCharityTotal;

  // "כולל הלוואות": the loan money that moved in the period, as the last step.
  // The same on every basis — a loan is never earned, it came in or went out.
  const loanSteps = useMemo(() => {
    if (!includeLoans || !loanFlows) return [];
    const sum = (items: LoanFlowItem[]) => items.reduce((total, item) => total + item.amount, 0);
    return [
      { key: "received", label: "הלוואות שקיבלתי", items: loanFlows.received, sign: 1 },
      { key: "repaid", label: "החזרתי על הלוואות", items: loanFlows.repaid, sign: -1 },
      { key: "lent", label: "הלוואות שנתתי", items: loanFlows.lent, sign: -1 },
      { key: "repaidToMe", label: "החזירו לי על הלוואות", items: loanFlows.repaidToMe, sign: 1 },
    ]
      .filter((step) => step.items.length > 0)
      .map((step) => ({ ...step, value: step.sign * sum(step.items) }));
  }, [includeLoans, loanFlows]);
  const loansTotal = loanSteps.reduce((sum, step) => sum + step.value, 0);
  const finalLeft = beforeLoans + loansTotal;

  const hasData =
    groups.business.length ||
    groups.overhead.length ||
    groups.homeCharity.length ||
    groups.properties.length ||
    loanSteps.length;

  // A single waterfall line. When earned-basis detail exists for the row's domain,
  // it becomes a clickable disclosure that opens the transactions behind the number.
  const line = (label: string, value: number, key: string, domain: string, effectiveBasis: Basis) => {
    const detail = detailFor(domain, effectiveBasis);
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
            <ChevronDownIcon className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", isOpen ? "" : "-rotate-90")} />
            {label}
          </span>
          <span dir="ltr" className={cn("tabular-nums text-sm font-medium", netClass(value))}>{signed(value)}</span>
        </button>
        {isOpen ? <DetailBlock detail={detail} effectiveBasis={effectiveBasis} /> : null}
      </div>
    );
  };

  // A loan line opens to the movements behind it: date, who, amount.
  const loanLine = (step: (typeof loanSteps)[number]) => {
    const key = `loan-${step.key}`;
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
            <ChevronDownIcon className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", isOpen ? "" : "-rotate-90")} />
            {step.label}
          </span>
          <span dir="ltr" className={cn("tabular-nums text-sm font-medium", netClass(step.value))}>{signed(step.value)}</span>
        </button>
        {isOpen ? (
          <div className="mb-2 mt-1 rounded-lg border bg-muted/30 p-3">
            <DetailColumn
              title={step.label}
              items={step.items}
              total={Math.abs(step.value)}
              empty="אין תנועות בתקופה."
              amountClass={step.value >= 0 ? "text-success" : "text-destructive"}
            />
          </div>
        ) : null}
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
        <EmptyState>
          אין נתונים להצגה עבור התקופה שנבחרה.
        </EmptyState>
      ) : (
        <>
          {/* Headline result */}
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="text-right">
                מה שנשאר בסוף {basis === "earned" ? "(לפי מה שהרווחתי)" : basis === "cash" ? "(לפי מה שנכנס)" : "(כולל פתוחים)"}
                {loanSteps.length > 0 ? " · כולל הלוואות" : ""}
              </CardDescription>
              <CardTitle className={cn("text-right text-3xl font-bold tabular-nums", netClass(finalLeft))}>
                <span dir="ltr">{formatCurrency(finalLeft)}</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                {/* The steps in the waterfall's order, each with its own sign
                    (a minus property result reads "− נכסים ₪X", not "− נכסים -₪X"). */}
                {`רווח מהעסקים ${formatCurrency(businessTotal)}`}
                {[
                  { label: "נכסים", value: propertiesTotal, show: groups.properties.length > 0 },
                  { label: "שוטף", value: overheadTotal, show: true },
                  { label: "בית/צדקה", value: homeCharityTotal, show: groups.homeCharity.length > 0 },
                  { label: "הלוואות", value: loansTotal, show: loanSteps.length > 0 },
                ]
                  .filter((step) => step.show)
                  .map((step) => ` ${step.value < 0 ? "−" : "+"} ${step.label} ${formatCurrency(Math.abs(step.value))}`)
                  .join("")}{" "}
                = {formatCurrency(finalLeft)}
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
                    .map((r, i) => line(r.name, r.net, `biz-${i}`, r.domain, basis))
                )}
                {runningRow(basis === "earned" ? "סה״כ שהרווחתי" : "רווח מכל העסקים", businessTotal, "__biz_total__")}
              </div>

              {groups.properties.length > 0 ? (
                <div className="py-2">
                  <div className="mb-1 text-xs font-medium text-muted-foreground">ועוד ניהול נכסים</div>
                  {groups.properties
                    .slice()
                    .sort((a, b) => b.net - a.net)
                    .map((r, i) => line(r.name, r.net, `prop-${i}`, r.domain, basis))}
                  {runningRow("סה״כ עם ניהול נכסים", afterProperties, "__after_properties__")}
                </div>
              ) : null}

              {groups.overhead.length > 0 ? (
                <div className="py-2">
                  <div className="mb-1 text-xs font-medium text-muted-foreground">פחות תקורה כללית (שוטף)</div>
                  {groups.overhead.map((r, i) => line(r.name, r.net, `ovh-${i}`, r.domain, basis))}
                  {runningRow("נשאר אחרי שוטף", afterOverhead, "__after_overhead__")}
                </div>
              ) : null}

              {groups.homeCharity.length > 0 ? (
                <div className="pt-2">
                  <div className="mb-1 text-xs font-medium text-muted-foreground">פחות בית וצדקה (מה שהמשפחה הוציאה)</div>
                  {groups.homeCharity
                    .slice()
                    .sort((a, b) => a.net - b.net)
                    .map((r, i) => line(r.name, r.net, `hc-${i}`, r.domain, basis))}
                  {loanSteps.length > 0 ? runningRow("נשאר לפני הלוואות", beforeLoans, "__before_loans__") : null}
                </div>
              ) : null}

              {includeLoans ? (
                <div className="pt-2">
                  <div className="mb-1 text-xs font-medium text-muted-foreground">ועוד הלוואות — כסף שנכנס ויצא בפועל, לא רווח</div>
                  {loanSteps.length === 0 ? (
                    <div className="py-1.5 text-sm text-muted-foreground">אין תנועות הלוואה בתקופה.</div>
                  ) : (
                    loanSteps.map((step) => loanLine(step))
                  )}
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
function DetailBlock({ detail, effectiveBasis }: { detail: RowDetail; effectiveBasis: Basis }) {
  const netTotal = detail.incomeTotal - detail.expenseTotal;
  const incomeTitle =
    effectiveBasis === "earned" ? "מה שהרווחתי" : effectiveBasis === "accrual" ? "הכנסות (כולל פתוחים)" : "מה שנכנס";
  const expenseTitle =
    effectiveBasis === "earned" ? "על מה הוצאתי" : effectiveBasis === "accrual" ? "הוצאות (כולל פתוחים)" : "מה ששילמתי";
  return (
    <div className="mb-2 mt-1 rounded-lg border bg-muted/30 p-3">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <DetailColumn
          title={incomeTitle}
          items={detail.income}
          total={detail.incomeTotal}
          empty="אין הכנסות בתקופה."
          amountClass="text-success"
        />
        <DetailColumn
          title={expenseTitle}
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
                <span className="min-w-0 flex-1">{item.label}</span>
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

"use client";

import { useMemo, useState } from "react";
import { DownloadIcon, PrintIcon } from "@/components/ui/icons";
import DomainBarChart from "@/components/charts/DomainBarChart";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatShortDate } from "@/lib/date";
import { cn } from "@/lib/utils";
import type { ProfitLossCategoryRow, ProfitLossDomainRow } from "@/lib/financial";
import type { EarnedRevenueReport } from "@/lib/financial/earnedRevenue";
import type { ProjectBreakdown } from "@/lib/financial/projectBreakdown";
import type { DomainProofMap } from "@/lib/financial/domainProof";
import { getBusinessDomainLabel } from "@/lib/expenses";

// cash = money in/out this period; accrual = + open debts; earned = booked to the
// month made. Chosen globally (top control row) and passed in as a prop.
type Basis = "cash" | "accrual" | "earned";

const currencyFormatter = new Intl.NumberFormat("he-IL", {
  style: "currency",
  currency: "ILS",
  maximumFractionDigits: 0,
});

function formatCurrency(value: number) {
  return currencyFormatter.format(Math.round(value));
}

function netClass(value: number) {
  if (value > 0) return "text-success";
  if (value < 0) return "text-destructive";
  return "text-foreground";
}

function formatPercent(value: number, withSign = false) {
  const sign = withSign && value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

// % change vs a base; null when there's no comparable base (previous was 0).
function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function formatShortMonth(iso: string | null) {
  if (!iso) return "";
  const [year, month] = iso.split("-");
  return `${month}/${year.slice(-2)}`;
}

/**
 * Embedded profit & loss panel (Reports → רווח והפסד). The date range comes from
 * the shared financial filter bar; basis (בפועל / כולל פתוחים) and include-personal
 * are client-only toggles that need no re-fetch.
 */
export default function ProfitLossPanel({
  rows,
  earned,
  projectBreakdown,
  domainProof,
  expenseCategories,
  previousRows,
  previousPeriod,
  from,
  to,
  basis,
  includePersonal,
  selectedDomains,
}: {
  rows: ProfitLossDomainRow[];
  earned: EarnedRevenueReport | null;
  projectBreakdown?: ProjectBreakdown | null;
  domainProof?: DomainProofMap | null;
  expenseCategories: ProfitLossCategoryRow[];
  previousRows: ProfitLossDomainRow[];
  previousPeriod: { from: string; to: string } | null;
  from: string | null;
  to: string | null;
  basis: Basis;
  includePersonal: boolean;
  /** Global domain chips (empty = all). Chosen in the report control row. */
  selectedDomains: string[];
}) {
  const isEarned = basis === "earned";
  const [projectDetailOpen, setProjectDetailOpen] = useState(false);
  const [domainProofOpen, setDomainProofOpen] = useState(true);

  const domainMatchesSelection = useMemo(() => {
    const set = new Set(selectedDomains);
    return (domain: string | null) => set.size === 0 || set.has(domain ?? "__unassigned__");
  }, [selectedDomains]);

  // Normalize every domain to {domain, domainName, isPersonal, revenue, expense}
  // for the active basis. Earned pulls from the earned report (business + שוטף);
  // personal (home/charity) always uses actual cash-out and only when toggled on.
  const normalizedRows = useMemo(() => {
    if (isEarned && earned) {
      const biz = earned.domains.map((d) => {
        const c = earned.totals.byDomain[d.key];
        return { domain: d.key, domainName: d.label, isPersonal: false, revenue: c?.income ?? 0, expense: c?.expense ?? 0 };
      });
      const personal = includePersonal
        ? rows
            .filter((r) => r.isPersonal)
            .map((r) => ({ domain: r.domain, domainName: r.domainName, isPersonal: true, revenue: r.cashRevenue, expense: r.cashExpense }))
        : [];
      return [...biz, ...personal];
    }
    return rows
      .filter((r) => includePersonal || !r.isPersonal)
      .map((r) => ({
        domain: r.domain,
        domainName: r.domainName,
        isPersonal: r.isPersonal,
        revenue: basis === "accrual" ? r.accrualRevenue : r.cashRevenue,
        expense: basis === "accrual" ? r.accrualExpense : r.cashExpense,
      }));
  }, [basis, isEarned, earned, rows, includePersonal]);

  const visibleRows = useMemo(
    () => normalizedRows.filter((row) => domainMatchesSelection((row.domain as string | null) ?? null)),
    [normalizedRows, domainMatchesSelection]
  );

  const view = useMemo(() => {
    const mapped = visibleRows.map((row) => ({
      domain: (row.domain as string | null) ?? null,
      domainName: row.domainName,
      revenue: row.revenue,
      expense: row.expense,
      net: row.revenue - row.expense,
    }));
    const totals = mapped.reduce(
      (acc, row) => {
        acc.revenue += row.revenue;
        acc.expense += row.expense;
        return acc;
      },
      { revenue: 0, expense: 0 }
    );
    return { rows: mapped, totals: { ...totals, net: totals.revenue - totals.expense } };
  }, [visibleRows]);

  const chartData = useMemo(
    () =>
      view.rows
        .filter((row) => row.revenue !== 0 || row.expense !== 0)
        .map((row) => ({ name: row.domainName, inflow: row.revenue, outflow: row.expense })),
    [view.rows]
  );

  // Net margin = net profit as a share of revenue (gross margin needs a COGS split — not modeled yet).
  const netMargin = view.totals.revenue > 0 ? (view.totals.net / view.totals.revenue) * 100 : null;

  // Immediately-preceding equal-length period, for the period-over-period comparison.
  const previousTotals = useMemo(() => {
    const totals = previousRows
      .filter((row) => (includePersonal || !row.isPersonal) && domainMatchesSelection(row.domain))
      .reduce(
        (acc, row) => {
          acc.revenue += basis === "cash" ? row.cashRevenue : row.accrualRevenue;
          acc.expense += basis === "cash" ? row.cashExpense : row.accrualExpense;
          return acc;
        },
        { revenue: 0, expense: 0 }
      );
    return { ...totals, net: totals.revenue - totals.expense };
  }, [previousRows, includePersonal, basis, domainMatchesSelection]);
  // Comparison + category breakdown only exist for cash/accrual (not earned).
  const hasComparison = !isEarned && previousPeriod != null && previousRows.length > 0;

  // Expense line items by category, with each line as a % of revenue.
  const categoryRows = useMemo(() => {
    if (isEarned) return [];
    const revenue = view.totals.revenue;
    return expenseCategories
      .map((row) => {
        const amount = basis === "cash" ? row.cashExpense : row.accrualExpense;
        return {
          category: row.category,
          amount,
          pctOfRevenue: revenue > 0 ? (amount / revenue) * 100 : null,
        };
      })
      .filter((row) => row.amount !== 0)
      .sort((left, right) => right.amount - left.amount);
  }, [expenseCategories, basis, isEarned, view.totals.revenue]);
  const categoryTotal = categoryRows.reduce((sum, row) => sum + row.amount, 0);

  const periodLabel = `${from ? formatShortDate(from) : "—"} – ${to ? formatShortDate(to) : "—"}`;
  const basisLabel = basis === "cash" ? "נכנס בפועל" : basis === "earned" ? "מה שהרווחתי" : "כולל פתוחים";
  const comparisonMetrics: Array<{ label: string; current: number; previous: number; goodWhenUp: boolean }> = [
    { label: "הכנסות", current: view.totals.revenue, previous: previousTotals.revenue, goodWhenUp: true },
    { label: "הוצאות", current: view.totals.expense, previous: previousTotals.expense, goodWhenUp: false },
    { label: "רווח נקי", current: view.totals.net, previous: previousTotals.net, goodWhenUp: true },
  ];

  function exportCsv() {
    const csvCell = (value: unknown) => {
      const text = String(value ?? "");
      return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const headers = ["תחום", "הכנסות", "הוצאות", "רווח/הפסד"];
    const lines = view.rows.map((row) => [row.domainName, row.revenue, row.expense, row.net]);
    const totalsLine = ["סה״כ", view.totals.revenue, view.totals.expense, view.totals.net];
    const csv = [headers, ...lines, totalsLine].map((row) => row.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `profit-loss-${basis}-${from || "all"}_${to || "all"}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4 text-right" dir="rtl">
      {/* Controls — basis/personal are global now; keep export/print here. */}
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <span className="text-xs text-muted-foreground">
          {basis === "cash" ? "לפי כסף שנכנס/יצא בפועל" : basis === "earned" ? "לפי מה שהרווחתי בתקופה" : "בפועל בתוספת חובות פתוחים"}
        </span>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={exportCsv}>
            <DownloadIcon className="ml-1 h-4 w-4" />
            ייצוא CSV
          </Button>
          <Button type="button" size="sm" onClick={() => window.print()}>
            <PrintIcon className="ml-1 h-4 w-4" />
            הדפסה / PDF
          </Button>
        </div>
      </div>

      {/* Print-only header */}
      <div className="hidden text-right print:block">
        <h2 className="text-lg font-semibold">דוח רווח והפסד</h2>
        <p className="text-sm">
          {basisLabel} • {periodLabel}
        </p>
      </div>

      {/* Summary cards */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-right">סה״כ הכנסות</CardDescription>
          </CardHeader>
          <CardContent>
            <div dir="ltr" className="text-right text-2xl font-semibold tabular-nums text-success">
              {formatCurrency(view.totals.revenue)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-right">סה״כ הוצאות</CardDescription>
          </CardHeader>
          <CardContent>
            <div dir="ltr" className="text-right text-2xl font-semibold tabular-nums text-destructive">
              {formatCurrency(view.totals.expense)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-right">רווח נקי</CardDescription>
          </CardHeader>
          <CardContent>
            <div dir="ltr" className={cn("text-right text-2xl font-semibold tabular-nums", netClass(view.totals.net))}>
              {formatCurrency(view.totals.net)}
            </div>
            {netMargin != null ? (
              <div className="mt-1 text-xs text-muted-foreground">שולי רווח נקי {formatPercent(netMargin)}</div>
            ) : null}
          </CardContent>
        </Card>
      </section>

      {hasComparison ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-right">השוואה לתקופה הקודמת</CardTitle>
            <CardDescription className="text-right">
              מול {formatShortMonth(previousPeriod?.from ?? null)}–{formatShortMonth(previousPeriod?.to ?? null)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead className="border-b text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">מדד</th>
                    <th className="px-3 py-2 font-medium">תקופה נוכחית</th>
                    <th className="px-3 py-2 font-medium">תקופה קודמת</th>
                    <th className="px-3 py-2 font-medium">שינוי</th>
                  </tr>
                </thead>
                <tbody>
                  {comparisonMetrics.map((metric) => {
                    const change = pctChange(metric.current, metric.previous);
                    const improved = metric.current >= metric.previous ? metric.goodWhenUp : !metric.goodWhenUp;
                    return (
                      <tr key={metric.label} className="border-b last:border-b-0">
                        <td className="px-3 py-2.5 font-medium">{metric.label}</td>
                        <td dir="ltr" className="px-3 py-2.5 text-right tabular-nums">{formatCurrency(metric.current)}</td>
                        <td dir="ltr" className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                          {formatCurrency(metric.previous)}
                        </td>
                        <td
                          dir="ltr"
                          className={cn(
                            "px-3 py-2.5 text-right font-medium tabular-nums",
                            change == null ? "text-muted-foreground" : improved ? "text-success" : "text-destructive"
                          )}
                        >
                          {change == null ? "—" : formatPercent(change, true)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {chartData.length > 0 ? (
        <Card className="print:hidden">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-right">הכנסות מול הוצאות לפי תחום</CardTitle>
          </CardHeader>
          <CardContent>
            <DomainBarChart data={chartData} height={240} />
          </CardContent>
        </Card>
      ) : null}

      {/* By-domain table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-right">פירוט לפי תחום</CardTitle>
        </CardHeader>
        <CardContent>
          {view.rows.length === 0 ? (
            <EmptyState>
              אין נתונים להצגה עבור התקופה והסינון שנבחרו.
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead className="border-b text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">תחום</th>
                    <th className="px-3 py-2 font-medium">הכנסות</th>
                    <th className="px-3 py-2 font-medium">הוצאות</th>
                    <th className="px-3 py-2 font-medium">רווח/הפסד</th>
                  </tr>
                </thead>
                <tbody>
                  {view.rows.map((row) => (
                    <tr key={row.domain ?? "__unassigned__"} className="border-b last:border-b-0">
                      <td className="px-3 py-2.5 font-medium">{row.domainName}</td>
                      <td dir="ltr" className="px-3 py-2.5 text-right tabular-nums text-success">
                        {formatCurrency(row.revenue)}
                      </td>
                      <td dir="ltr" className="px-3 py-2.5 text-right tabular-nums text-destructive">
                        {formatCurrency(row.expense)}
                      </td>
                      <td dir="ltr" className={cn("px-3 py-2.5 text-right font-semibold tabular-nums", netClass(row.net))}>
                        {formatCurrency(row.net)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 font-semibold">
                    <td className="px-3 py-3">סה״כ</td>
                    <td dir="ltr" className="px-3 py-3 text-right tabular-nums text-success">
                      {formatCurrency(view.totals.revenue)}
                    </td>
                    <td dir="ltr" className="px-3 py-3 text-right tabular-nums text-destructive">
                      {formatCurrency(view.totals.expense)}
                    </td>
                    <td dir="ltr" className={cn("px-3 py-3 text-right tabular-nums", netClass(view.totals.net))}>
                      {formatCurrency(view.totals.net)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            {basis === "cash"
              ? "נכנס בפועל: הכנסות שנגבו והוצאות ששולמו בתקופה."
              : basis === "earned"
                ? "מה שהרווחתי: הכנסה לפי החודש שבו נוצרה (הזמנות/פרויקטים), כולל מה שעדיין לא נגבה. פירוט קטגוריות והשוואה זמינים במצב ״נכנס בפועל״."
                : "כולל פתוחים: בפועל בתוספת חובות לקוחות פתוחים (הכנסות) והתחייבויות פתוחות (הוצאות)."}
          </p>
        </CardContent>
      </Card>

      {/* Per-project detail — proves the פרויקטים number. Two income columns (full
          price + this-period's share) and two expense columns (full project cost +
          what was actually spent this period, on its real date — NOT spread).
          Only shown when viewing all domains or פרויקטים specifically. */}
      {projectBreakdown &&
      projectBreakdown.rows.length > 0 &&
      (selectedDomains.length === 0 || selectedDomains.includes("logistics_projects")) ? (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base text-right">פירוט פרויקטים — למה המספר נכון</CardTitle>
                <CardDescription className="text-right">
                  {projectBreakdown.rows.length} פרויקטים פעילים • הכנסות {formatCurrency(projectBreakdown.totals.earnedShare)} • הוצאות{" "}
                  {formatCurrency(projectBreakdown.domainExpense)} • נטו {formatCurrency(projectBreakdown.totals.earnedShare - projectBreakdown.domainExpense)}
                </CardDescription>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => setProjectDetailOpen((v) => !v)}>
                {projectDetailOpen ? "הסתר פירוט" : "הצג פירוט"}
              </Button>
            </div>
          </CardHeader>
          {projectDetailOpen ? (
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-right text-sm">
                  <thead className="border-b text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">פרויקט</th>
                      <th className="px-3 py-2 font-medium">מחיר מלא</th>
                      <th className="px-3 py-2 font-medium">הכנסה בתקופה</th>
                      <th className="px-3 py-2 font-medium">הוצאות מלאות</th>
                      <th className="px-3 py-2 font-medium">הוצאות בתקופה</th>
                      <th className="px-3 py-2 font-medium">נטו</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projectBreakdown.rows.map((row) => (
                      <tr key={row.projectId} className="border-b last:border-b-0">
                        <td className="px-3 py-2.5 font-medium">{row.name}</td>
                        <td dir="ltr" className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                          {formatCurrency(row.fullPrice)}
                        </td>
                        <td dir="ltr" className="px-3 py-2.5 text-right tabular-nums text-success">
                          {formatCurrency(row.earnedShare)}
                          {row.monthsInSpan > 1 ? (
                            <span className="ms-1 text-[10px] text-muted-foreground">
                              ({row.monthsInPeriod}/{row.monthsInSpan})
                            </span>
                          ) : null}
                        </td>
                        <td dir="ltr" className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                          {formatCurrency(row.fullExpenses)}
                        </td>
                        <td dir="ltr" className="px-3 py-2.5 text-right tabular-nums text-destructive">
                          {formatCurrency(row.periodExpenses)}
                        </td>
                        <td dir="ltr" className={cn("px-3 py-2.5 text-right font-semibold tabular-nums", netClass(row.net))}>
                          {formatCurrency(row.net)}
                        </td>
                      </tr>
                    ))}
                    {projectBreakdown.unassignedExpense > 0 ? (
                      <tr className="border-b last:border-b-0 text-muted-foreground">
                        <td className="px-3 py-2.5">הוצאות פרויקטים כלליות (לא שויך)</td>
                        <td className="px-3 py-2.5">—</td>
                        <td className="px-3 py-2.5">—</td>
                        <td className="px-3 py-2.5">—</td>
                        <td dir="ltr" className="px-3 py-2.5 text-right tabular-nums text-destructive">
                          {formatCurrency(projectBreakdown.unassignedExpense)}
                        </td>
                        <td dir="ltr" className="px-3 py-2.5 text-right tabular-nums text-destructive">
                          {formatCurrency(-projectBreakdown.unassignedExpense)}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 font-semibold">
                      <td className="px-3 py-3">סה״כ</td>
                      <td dir="ltr" className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                        {formatCurrency(projectBreakdown.rows.reduce((s, r) => s + r.fullPrice, 0))}
                      </td>
                      <td dir="ltr" className="px-3 py-3 text-right tabular-nums text-success">
                        {formatCurrency(projectBreakdown.totals.earnedShare)}
                      </td>
                      <td dir="ltr" className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                        {formatCurrency(projectBreakdown.rows.reduce((s, r) => s + r.fullExpenses, 0))}
                      </td>
                      <td dir="ltr" className="px-3 py-3 text-right tabular-nums text-destructive">
                        {formatCurrency(projectBreakdown.domainExpense)}
                      </td>
                      <td dir="ltr" className={cn("px-3 py-3 text-right tabular-nums", netClass(projectBreakdown.totals.earnedShare - projectBreakdown.domainExpense))}>
                        {formatCurrency(projectBreakdown.totals.earnedShare - projectBreakdown.domainExpense)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                ״מחיר מלא״ ו״הוצאות מלאות״ = הסכומים שבעמוד הפרויקט, וסכומם שווה למסך ״סיכום פרויקטים לפי חודש״.
                ״הכנסה בתקופה״ = חלק המחיר ששייך לתקופה (מחיר הפרויקט מחולק על חודשיו). ״הוצאות בתקופה״ = מה
                שבאמת הוצא בתקופה, לפי התאריך בפועל (לא מחולק). נטו = הכנסה בתקופה − הוצאות בתקופה, וסכומו שווה
                למספר של פרויקטים בלשונית זו. ההפרש בין ״הוצאות מלאות״ ל״הוצאות בתקופה״ = עלויות של פרויקט שנרשמו
                בחודש אחר.
              </p>
            </CardContent>
          ) : null}
        </Card>
      ) : null}

      {/* Per-transaction proof for a single non-project domain (sales / שוטף / …).
          Shown when exactly one such domain is selected — lists the orders/payments
          behind its income and the expenses behind its costs, summing to the row. */}
      {(() => {
        const soloDomain = selectedDomains.length === 1 ? selectedDomains[0] : null;
        const proof = soloDomain && soloDomain !== "logistics_projects" ? domainProof?.[soloDomain] ?? null : null;
        if (!soloDomain || !proof || (proof.income.length === 0 && proof.expenses.length === 0)) return null;
        const label = getBusinessDomainLabel(soloDomain === "__unassigned__" ? null : soloDomain);
        return (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base text-right">פירוט {label} — למה המספר נכון</CardTitle>
                  <CardDescription className="text-right">
                    {proof.income.length} תנועות הכנסה • {proof.expenses.length} תנועות הוצאה • הכנסות{" "}
                    {formatCurrency(proof.incomeTotal)} • הוצאות {formatCurrency(proof.expenseTotal)} • נטו{" "}
                    {formatCurrency(proof.incomeTotal - proof.expenseTotal)}
                  </CardDescription>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => setDomainProofOpen((v) => !v)}>
                  {domainProofOpen ? "הסתר פירוט" : "הצג פירוט"}
                </Button>
              </div>
            </CardHeader>
            {domainProofOpen ? (
              <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">הכנסות</div>
                  {proof.income.length === 0 ? (
                    <div className="py-2 text-sm text-muted-foreground">אין הכנסות בתקופה.</div>
                  ) : (
                    <div className="divide-y">
                      {proof.income.map((item, i) => (
                        <div key={`in-${i}`} className="flex items-center gap-3 py-1.5 text-sm">
                          <span className="w-16 shrink-0 text-xs text-muted-foreground">
                            <span dir="ltr">{item.date ? item.date.slice(8, 10) + "/" + item.date.slice(5, 7) : "—"}</span>
                          </span>
                          <span className="min-w-0 flex-1 truncate">{item.label}</span>
                          <span dir="ltr" className="shrink-0 tabular-nums font-medium text-success">{formatCurrency(item.amount)}</span>
                        </div>
                      ))}
                      <div className="flex items-center justify-between gap-3 border-t-2 py-2 font-semibold">
                        <span>סה״כ הכנסות</span>
                        <span dir="ltr" className="tabular-nums text-success">{formatCurrency(proof.incomeTotal)}</span>
                      </div>
                    </div>
                  )}
                </div>
                <div>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">הוצאות</div>
                  {proof.expenses.length === 0 ? (
                    <div className="py-2 text-sm text-muted-foreground">אין הוצאות בתקופה.</div>
                  ) : (
                    <div className="divide-y">
                      {proof.expenses.map((item, i) => (
                        <div key={`ex-${i}`} className="flex items-center gap-3 py-1.5 text-sm">
                          <span className="w-16 shrink-0 text-xs text-muted-foreground">
                            <span dir="ltr">{item.date ? item.date.slice(8, 10) + "/" + item.date.slice(5, 7) : "—"}</span>
                          </span>
                          <span className="min-w-0 flex-1 truncate">{item.label}</span>
                          <span dir="ltr" className="shrink-0 tabular-nums font-medium text-destructive">{formatCurrency(item.amount)}</span>
                        </div>
                      ))}
                      <div className="flex items-center justify-between gap-3 border-t-2 py-2 font-semibold">
                        <span>סה״כ הוצאות</span>
                        <span dir="ltr" className="tabular-nums text-destructive">{formatCurrency(proof.expenseTotal)}</span>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            ) : null}
          </Card>
        );
      })()}

      {selectedDomains.length === 0 ? (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-right">הוצאות לפי קטגוריה</CardTitle>
          <CardDescription className="text-right">הוצאות עסקיות לפי קטגוריה, וכאחוז מההכנסות.</CardDescription>
        </CardHeader>
        <CardContent>
          {categoryRows.length === 0 ? (
            <EmptyState>
              אין הוצאות להצגה עבור התקופה והסינון שנבחרו.
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead className="border-b text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">קטגוריה</th>
                    <th className="px-3 py-2 font-medium">סכום</th>
                    <th className="px-3 py-2 font-medium">% מהכנסות</th>
                  </tr>
                </thead>
                <tbody>
                  {categoryRows.map((row) => (
                    <tr key={row.category} className="border-b last:border-b-0">
                      <td className="px-3 py-2.5 font-medium">{row.category}</td>
                      <td dir="ltr" className="px-3 py-2.5 text-right tabular-nums text-destructive">
                        {formatCurrency(row.amount)}
                      </td>
                      <td dir="ltr" className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                        {row.pctOfRevenue == null ? "—" : formatPercent(row.pctOfRevenue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 font-semibold">
                    <td className="px-3 py-3">סה״כ הוצאות</td>
                    <td dir="ltr" className="px-3 py-3 text-right tabular-nums text-destructive">
                      {formatCurrency(categoryTotal)}
                    </td>
                    <td dir="ltr" className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                      {view.totals.revenue > 0 ? formatPercent((categoryTotal / view.totals.revenue) * 100) : "—"}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      ) : null}
    </div>
  );
}

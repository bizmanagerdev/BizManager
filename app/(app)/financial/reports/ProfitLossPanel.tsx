"use client";

import { useMemo, useState } from "react";
import { Download, Printer } from "lucide-react";
import DomainBarChart from "@/components/charts/DomainBarChart";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatShortDate } from "@/lib/date";
import { cn } from "@/lib/utils";
import type { ProfitLossCategoryRow, ProfitLossDomainRow } from "@/lib/financial";

type Basis = "cash" | "accrual";

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
  expenseCategories,
  previousRows,
  previousPeriod,
  from,
  to,
}: {
  rows: ProfitLossDomainRow[];
  expenseCategories: ProfitLossCategoryRow[];
  previousRows: ProfitLossDomainRow[];
  previousPeriod: { from: string; to: string } | null;
  from: string | null;
  to: string | null;
}) {
  const [basis, setBasis] = useState<Basis>("cash");
  const [includePersonal, setIncludePersonal] = useState(false);

  const visibleRows = useMemo(
    () => rows.filter((row) => includePersonal || !row.isPersonal),
    [rows, includePersonal]
  );

  const view = useMemo(() => {
    const mapped = visibleRows.map((row) => {
      const revenue = basis === "cash" ? row.cashRevenue : row.accrualRevenue;
      const expense = basis === "cash" ? row.cashExpense : row.accrualExpense;
      return { domain: row.domain, domainName: row.domainName, revenue, expense, net: revenue - expense };
    });
    const totals = mapped.reduce(
      (acc, row) => {
        acc.revenue += row.revenue;
        acc.expense += row.expense;
        return acc;
      },
      { revenue: 0, expense: 0 }
    );
    return { rows: mapped, totals: { ...totals, net: totals.revenue - totals.expense } };
  }, [visibleRows, basis]);

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
      .filter((row) => includePersonal || !row.isPersonal)
      .reduce(
        (acc, row) => {
          acc.revenue += basis === "cash" ? row.cashRevenue : row.accrualRevenue;
          acc.expense += basis === "cash" ? row.cashExpense : row.accrualExpense;
          return acc;
        },
        { revenue: 0, expense: 0 }
      );
    return { ...totals, net: totals.revenue - totals.expense };
  }, [previousRows, includePersonal, basis]);
  const hasComparison = previousPeriod != null && previousRows.length > 0;

  // Expense line items by category, with each line as a % of revenue.
  const categoryRows = useMemo(() => {
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
  }, [expenseCategories, basis, view.totals.revenue]);
  const categoryTotal = categoryRows.reduce((sum, row) => sum + row.amount, 0);

  const periodLabel = `${from ? formatShortDate(from) : "—"} – ${to ? formatShortDate(to) : "—"}`;
  const basisLabel = basis === "cash" ? "בפועל" : "כולל פתוחים";
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
      {/* Controls */}
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div className="space-y-1.5 text-sm">
          <span className="font-medium">בסיס חישוב</span>
          <div className="flex overflow-hidden rounded-lg border">
            <button
              type="button"
              onClick={() => setBasis("cash")}
              className={cn(
                "px-3 py-2 text-sm transition-colors",
                basis === "cash" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
              )}
            >
              בפועל
            </button>
            <button
              type="button"
              onClick={() => setBasis("accrual")}
              className={cn(
                "px-3 py-2 text-sm transition-colors",
                basis === "accrual" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
              )}
            >
              כולל פתוחים
            </button>
          </div>
        </div>

        <label className="flex cursor-pointer items-center gap-2 self-end pb-2 text-sm">
          <input
            type="checkbox"
            checked={includePersonal}
            onChange={(event) => setIncludePersonal(event.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          <span>כולל בית וצדקה</span>
        </label>

        <div className="ms-auto flex items-end gap-2 self-end pb-1">
          <Button type="button" variant="outline" size="sm" onClick={exportCsv}>
            <Download className="ml-1 h-4 w-4" />
            ייצוא CSV
          </Button>
          <Button type="button" size="sm" onClick={() => window.print()}>
            <Printer className="ml-1 h-4 w-4" />
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
      <section className="grid gap-3 sm:grid-cols-3">
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
            <div className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
              אין נתונים להצגה עבור התקופה והסינון שנבחרו.
            </div>
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
              ? "בפועל: הכנסות שנגבו והוצאות ששולמו בתקופה."
              : "כולל פתוחים: בפועל בתוספת חובות לקוחות פתוחים (הכנסות) והתחייבויות פתוחות (הוצאות)."}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-right">הוצאות לפי קטגוריה</CardTitle>
          <CardDescription className="text-right">הוצאות עסקיות לפי קטגוריה, וכאחוז מההכנסות.</CardDescription>
        </CardHeader>
        <CardContent>
          {categoryRows.length === 0 ? (
            <div className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              אין הוצאות להצגה עבור התקופה והסינון שנבחרו.
            </div>
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
    </div>
  );
}

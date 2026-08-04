"use client";

import { Fragment, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import type { EarnedDomainCell, EarnedRevenueReport } from "@/lib/financial/earnedRevenue";

const currencyFormatter = new Intl.NumberFormat("he-IL", {
  style: "currency",
  currency: "ILS",
  maximumFractionDigits: 0,
});

function formatCurrency(value: number) {
  return currencyFormatter.format(Math.round(value));
}

function formatMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-");
  return `${month}/${year.slice(-2)}`;
}

function netClass(value: number) {
  if (value > 0.5) return "text-success";
  if (value < -0.5) return "text-destructive";
  return "text-foreground";
}

function hasActivity(cell: EarnedDomainCell) {
  return cell.count !== 0 || Math.round(cell.income) !== 0 || Math.round(cell.expense) !== 0;
}

/**
 * Reports → רווח עבודה חודשי: earned (booked) income, expenses and net per month,
 * per domain. Accrual basis — attributed to the month the work belongs to, not
 * the month its cash cleared (that's the מגמה חודשית tab).
 */
const EMPTY_CELL: EarnedDomainCell = { count: 0, income: 0, expense: 0, net: 0 };

function sumCells(cells: EarnedDomainCell[]): EarnedDomainCell {
  return cells.reduce(
    (acc, c) => ({
      count: acc.count + c.count,
      income: acc.income + c.income,
      expense: acc.expense + c.expense,
      net: acc.net + c.net,
    }),
    { ...EMPTY_CELL }
  );
}

export default function EarnedRevenuePanel({
  report,
  selectedDomains,
}: {
  report: EarnedRevenueReport;
  /** Global domain chips (empty = all), chosen in the report control row. */
  selectedDomains: string[];
}) {
  const { domains } = report;

  const activeDomainKeys = useMemo(() => {
    const set = new Set(selectedDomains);
    return set.size === 0 ? domains.map((d) => d.key) : domains.map((d) => d.key).filter((k) => set.has(k));
  }, [domains, selectedDomains]);

  // Recompute per-month and grand totals from the selected domains only, so the
  // total row always matches the visible domain rows.
  const months = useMemo(
    () =>
      report.months.map((m) => ({
        ...m,
        total: sumCells(activeDomainKeys.map((k) => m.byDomain[k] ?? EMPTY_CELL)),
      })),
    [report.months, activeDomainKeys]
  );
  const totals = useMemo(
    () => ({
      grand: sumCells(months.map((m) => m.total)),
    }),
    [months]
  );
  const visibleDomains = useMemo(
    () => domains.filter((d) => activeDomainKeys.includes(d.key)),
    [domains, activeDomainKeys]
  );

  if (report.months.length === 0 || domains.length === 0) {
    return (
      <EmptyState>
        אין נתוני הכנסה להצגה עבור התקופה שנבחרה.
      </EmptyState>
    );
  }

  // Newest month first; drop months where the selected domains have no activity.
  const orderedMonths = [...months]
    .filter((m) => m.total.count !== 0 || Math.round(m.total.income) !== 0 || Math.round(m.total.expense) !== 0)
    .reverse();

  return (
    <div className="space-y-4 text-right" dir="rtl">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-right">
            רווח עבודה חודשי לפי תחום — מה עשיתי החודש (גם אם עדיין לא נגבה)
          </CardTitle>
          <CardDescription className="text-right">
            הכנסה לפי ביצוע ולא לפי גבייה — נספרת בחודש שבו נוצרה, בלי קשר אם הכסף כבר ביד.
            הזמנות לפי תאריך ההזמנה; פרויקטים מחולקים שווה בשווה על חודשי הפרויקט; שאר התחומים לפי
            תקבולים/הוצאות באותו חודש. הוצאות אשראי לפי תאריך הקנייה. שכר עובדים נספר לפי חודש העבודה
            (גם אם שולם בחודש שאחרי) — משכורות כלליות לפי שוטף, ופרויקט־ייעודי לפי הפרויקט. סכומים כולל מע״מ.
            תחומים אישיים (בית/צדקה) אינם נכללים.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="border-b text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">תחום</th>
                  <th className="px-3 py-2 font-medium">כמות</th>
                  <th className="px-3 py-2 font-medium">הכנסות</th>
                  <th className="px-3 py-2 font-medium">הוצאות</th>
                  <th className="px-3 py-2 font-medium">נטו</th>
                </tr>
              </thead>
              <tbody>
                {orderedMonths.map((monthRow) => (
                  <Fragment key={monthRow.month}>
                    <tr className="border-b bg-muted/40">
                      <td
                        colSpan={5}
                        dir="ltr"
                        className="px-3 py-2 text-right font-semibold tabular-nums"
                      >
                        {formatMonthLabel(monthRow.month)}
                      </td>
                    </tr>
                    {visibleDomains
                      .filter((domain) => hasActivity(monthRow.byDomain[domain.key]))
                      .map((domain) => {
                        const cell = monthRow.byDomain[domain.key];
                        return (
                          <tr key={domain.key} className="border-b last:border-b-0">
                            <td className="px-3 py-2 pr-6">{domain.label}</td>
                            <td dir="ltr" className="px-3 py-2 text-right tabular-nums">
                              {cell.count > 0 ? cell.count : "—"}
                            </td>
                            <td dir="ltr" className="px-3 py-2 text-right tabular-nums">
                              {formatCurrency(cell.income)}
                            </td>
                            <td dir="ltr" className="px-3 py-2 text-right tabular-nums text-destructive">
                              {formatCurrency(cell.expense)}
                            </td>
                            <td
                              dir="ltr"
                              className={cn(
                                "px-3 py-2 text-right font-medium tabular-nums",
                                netClass(cell.net)
                              )}
                            >
                              {formatCurrency(cell.net)}
                            </td>
                          </tr>
                        );
                      })}
                    <tr className="border-b-2 font-semibold">
                      <td className="px-3 py-2 pr-6">סה״כ {formatMonthLabel(monthRow.month)}</td>
                      <td dir="ltr" className="px-3 py-2 text-right tabular-nums">
                        {monthRow.total.count > 0 ? monthRow.total.count : "—"}
                      </td>
                      <td dir="ltr" className="px-3 py-2 text-right tabular-nums">
                        {formatCurrency(monthRow.total.income)}
                      </td>
                      <td dir="ltr" className="px-3 py-2 text-right tabular-nums text-destructive">
                        {formatCurrency(monthRow.total.expense)}
                      </td>
                      <td
                        dir="ltr"
                        className={cn(
                          "px-3 py-2 text-right tabular-nums",
                          netClass(monthRow.total.net)
                        )}
                      >
                        {formatCurrency(monthRow.total.net)}
                      </td>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 text-base font-bold">
                  <td className="px-3 py-3">סה״כ הכל</td>
                  <td dir="ltr" className="px-3 py-3 text-right tabular-nums">
                    {totals.grand.count > 0 ? totals.grand.count : "—"}
                  </td>
                  <td dir="ltr" className="px-3 py-3 text-right tabular-nums">
                    {formatCurrency(totals.grand.income)}
                  </td>
                  <td dir="ltr" className="px-3 py-3 text-right tabular-nums text-destructive">
                    {formatCurrency(totals.grand.expense)}
                  </td>
                  <td
                    dir="ltr"
                    className={cn("px-3 py-3 text-right tabular-nums", netClass(totals.grand.net))}
                  >
                    {formatCurrency(totals.grand.net)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

"use client";

import { useMemo } from "react";
import ForecastChart from "@/components/charts/ForecastChart";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ForecastChangePoint } from "@/lib/financial";

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

function balanceClass(value: number) {
  if (value > 0) return "text-success";
  if (value < 0) return "text-destructive";
  return "text-foreground";
}

/**
 * Reports → תחזית: projected cash balance over the coming months. The running
 * balance starts from the current actual balance (the "יתרה בפועל" shown above) and
 * adds each month's expected net change from scheduled/pending items.
 */
export default function ForecastPanel({
  changes,
  openingBalance,
}: {
  changes: ForecastChangePoint[];
  openingBalance: number;
}) {
  const rows = useMemo(() => {
    const result: Array<{ month: string; change: number; balance: number }> = [];
    for (const point of changes) {
      const previous = result.length > 0 ? result[result.length - 1].balance : openingBalance;
      result.push({ month: point.month, change: point.change, balance: previous + point.change });
    }
    return result;
  }, [changes, openingBalance]);

  const chartData = useMemo(
    () => rows.map((row) => ({ name: formatMonthLabel(row.month), change: row.change, balance: row.balance })),
    [rows]
  );

  const endingBalance = rows.length > 0 ? rows[rows.length - 1].balance : openingBalance;
  const lowestPoint = rows.reduce(
    (min, row) => (row.balance < min.balance ? row : min),
    { month: "", balance: openingBalance }
  );
  const goesNegative = lowestPoint.balance < 0;

  if (changes.length === 0) {
    return (
      <div className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
        אין תנועות צפויות או ממתינות להצגת תחזית.
      </div>
    );
  }

  return (
    <div className="space-y-4 text-right" dir="rtl">
      <section className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-right">יתרה נוכחית (בסיס)</CardDescription>
          </CardHeader>
          <CardContent>
            <div dir="ltr" className={cn("text-right text-2xl font-semibold tabular-nums", balanceClass(openingBalance))}>
              {formatCurrency(openingBalance)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-right">יתרה צפויה בעוד {rows.length} חודשים</CardDescription>
          </CardHeader>
          <CardContent>
            <div dir="ltr" className={cn("text-right text-2xl font-semibold tabular-nums", balanceClass(endingBalance))}>
              {formatCurrency(endingBalance)}
            </div>
          </CardContent>
        </Card>
        <Card className={cn(goesNegative && "border-destructive/50")}>
          <CardHeader className="pb-2">
            <CardDescription className="text-right">נקודת השפל הצפויה</CardDescription>
          </CardHeader>
          <CardContent>
            <div dir="ltr" className={cn("text-right text-2xl font-semibold tabular-nums", balanceClass(lowestPoint.balance))}>
              {formatCurrency(lowestPoint.balance)}
            </div>
            {goesNegative && lowestPoint.month ? (
              <div className="mt-1 text-xs text-destructive">צפויה יתרה שלילית בחודש {formatMonthLabel(lowestPoint.month)}</div>
            ) : null}
          </CardContent>
        </Card>
      </section>

      <Card className="print:hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-right">תחזית יתרת מזומנים</CardTitle>
          <CardDescription className="text-right">
            יתרה צפויה לפי תקבולים ותשלומים מתוכננים/ממתינים, ל-{rows.length} החודשים הקרובים.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ForecastChart data={chartData} height={300} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-right">פירוט חודשי</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="border-b text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">חודש</th>
                  <th className="px-3 py-2 font-medium">שינוי צפוי</th>
                  <th className="px-3 py-2 font-medium">יתרה צפויה</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.month} className="border-b last:border-b-0">
                    <td dir="ltr" className="px-3 py-2.5 text-right font-medium tabular-nums">
                      {formatMonthLabel(row.month)}
                    </td>
                    <td dir="ltr" className={cn("px-3 py-2.5 text-right tabular-nums", row.change >= 0 ? "text-success" : "text-destructive")}>
                      {row.change >= 0 ? "+" : ""}
                      {formatCurrency(row.change)}
                    </td>
                    <td dir="ltr" className={cn("px-3 py-2.5 text-right font-semibold tabular-nums", balanceClass(row.balance))}>
                      {formatCurrency(row.balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            הבסיס הוא היתרה בפועל הנוכחית; כל חודש מוסיף את התקבולים הצפויים ומפחית את התשלומים הצפויים והממתינים.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

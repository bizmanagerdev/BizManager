"use client";

import { useMemo } from "react";
import MonthlyTrendChart from "@/components/charts/MonthlyTrendChart";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import type { MonthlyTrendPoint } from "@/lib/financial";

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
  if (value > 0) return "text-success";
  if (value < 0) return "text-destructive";
  return "text-foreground";
}

/** Reports → מגמה חודשית: realized income vs expense vs net, month by month. */
export default function MonthlyTrendPanel({ points }: { points: MonthlyTrendPoint[] }) {
  const chartData = useMemo(
    () =>
      points.map((point) => ({
        name: formatMonthLabel(point.month),
        inflow: point.inflow,
        outflow: point.outflow,
        net: point.net,
      })),
    [points]
  );

  const totals = useMemo(
    () =>
      points.reduce(
        (acc, point) => {
          acc.inflow += point.inflow;
          acc.outflow += point.outflow;
          return acc;
        },
        { inflow: 0, outflow: 0 }
      ),
    [points]
  );
  const totalNet = totals.inflow - totals.outflow;

  if (points.length === 0) {
    return (
      <EmptyState>
        אין תנועות בפועל להצגה עבור התקופה והסינון שנבחרו.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-4 text-right" dir="rtl">
      <Card className="print:hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-right">מגמה חודשית</CardTitle>
          <CardDescription className="text-right">
            הכנסות מול הוצאות ונטו בפועל, חודש אחר חודש.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MonthlyTrendChart data={chartData} height={300} />
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
                  <th className="px-3 py-2 font-medium">הכנסות</th>
                  <th className="px-3 py-2 font-medium">הוצאות</th>
                  <th className="px-3 py-2 font-medium">נטו</th>
                </tr>
              </thead>
              <tbody>
                {points.map((point) => (
                  <tr key={point.month} className="border-b last:border-b-0">
                    <td dir="ltr" className="px-3 py-2.5 text-right font-medium tabular-nums">
                      {formatMonthLabel(point.month)}
                    </td>
                    <td dir="ltr" className="px-3 py-2.5 text-right tabular-nums text-success">
                      {formatCurrency(point.inflow)}
                    </td>
                    <td dir="ltr" className="px-3 py-2.5 text-right tabular-nums text-destructive">
                      {formatCurrency(point.outflow)}
                    </td>
                    <td dir="ltr" className={cn("px-3 py-2.5 text-right font-semibold tabular-nums", netClass(point.net))}>
                      {formatCurrency(point.net)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 font-semibold">
                  <td className="px-3 py-3">סה״כ</td>
                  <td dir="ltr" className="px-3 py-3 text-right tabular-nums text-success">
                    {formatCurrency(totals.inflow)}
                  </td>
                  <td dir="ltr" className="px-3 py-3 text-right tabular-nums text-destructive">
                    {formatCurrency(totals.outflow)}
                  </td>
                  <td dir="ltr" className={cn("px-3 py-3 text-right tabular-nums", netClass(totalNet))}>
                    {formatCurrency(totalNet)}
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

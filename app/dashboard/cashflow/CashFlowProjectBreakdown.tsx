import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { CashFlowProjectBreakdownPoint } from "@/lib/cashflow";
import { formatCurrency } from "@/app/dashboard/cashflow/chart-utils";

export default function CashFlowProjectBreakdown({
  rows,
}: {
  rows: CashFlowProjectBreakdownPoint[];
}) {
  const visibleRows = rows.slice(0, 6);
  const maxAbsNet = visibleRows.reduce((max, row) => Math.max(max, Math.abs(row.net)), 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg text-right">תזרים לפי פרויקט</CardTitle>
        <CardDescription className="text-right">
          מי מביא כסף פנימה, ואיפה הכסף יוצא החוצה יותר מדי.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {visibleRows.length === 0 ? (
          <div className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            אין פרויקטים עם תנועות בתקופה הזו.
          </div>
        ) : (
          <div className="space-y-3">
            {visibleRows.map((row) => {
              const width = maxAbsNet > 0 ? `${(Math.abs(row.net) / maxAbsNet) * 100}%` : "0%";
              const isPositive = row.net >= 0;

              return (
                <div key={`${row.projectId ?? "none"}-${row.projectName}`} className="rounded-2xl border p-4 text-right">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-medium">{row.projectName}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        הכנסות {formatCurrency(row.inflow)} | הוצאות {formatCurrency(row.outflow)}
                      </div>
                    </div>
                    <div className={isPositive ? "font-semibold text-emerald-700" : "font-semibold text-rose-700"}>
                      {formatCurrency(row.net)}
                    </div>
                  </div>
                  <div className="mt-3 h-2.5 rounded-full bg-muted">
                    <div
                      className={isPositive ? "h-2.5 rounded-full bg-[hsl(var(--chart-5))]" : "h-2.5 rounded-full bg-[hsl(var(--chart-2))]"}
                      style={{ width }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

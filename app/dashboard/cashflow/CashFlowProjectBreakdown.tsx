import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { CashFlowDomainBreakdownPoint } from "@/lib/cashflow";
import { formatCurrency } from "@/app/dashboard/cashflow/chart-utils";
import { ChevronDown } from "lucide-react";

export default function CashFlowProjectBreakdown({
  rows,
}: {
  rows: CashFlowDomainBreakdownPoint[];
}) {
  const visibleRows = rows.slice(0, 6);
  const maxAbsNet = visibleRows.reduce((max, row) => Math.max(max, Math.abs(row.net)), 0);

  return (
    <Card>
      <details className="group" open>
        <summary className="list-none cursor-pointer">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1 text-right">
                <CardTitle className="text-lg text-right">תזרים לפי תחום</CardTitle>
                <CardDescription className="text-right">
                  הצגה של הכנסות והוצאות לפי תחומי העסק, כשהפרויקט נשאר פרט משני בתוך כל תנועה.
                </CardDescription>
              </div>
              <div className="flex h-9 w-9 items-center justify-center rounded-full border bg-muted/40 transition-transform group-open:rotate-180">
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </div>
            </div>
          </CardHeader>
        </summary>
        <CardContent>
          {visibleRows.length === 0 ? (
            <div className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              אין תחומים עם תנועות בתקופה הזו.
            </div>
          ) : (
            <div className="space-y-3">
              {visibleRows.map((row) => {
                const width = maxAbsNet > 0 ? `${(Math.abs(row.net) / maxAbsNet) * 100}%` : "0%";
                const isPositive = row.net >= 0;

                return (
                  <div key={row.domain ?? "none"} className="rounded-2xl border p-4 text-right">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="font-medium">{row.domainName}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          הכנסות {formatCurrency(row.inflow)} | הוצאות {formatCurrency(row.outflow)}
                        </div>
                      </div>
                      <div className={isPositive ? "font-semibold text-success-soft-foreground" : "font-semibold text-destructive"}>
                        {formatCurrency(row.net)}
                      </div>
                    </div>
                    <div className="mt-3 h-2.5 rounded-full bg-muted">
                      <div
                        className={isPositive ? "h-2.5 rounded-full bg-[rgb(var(--chart-5))]" : "h-2.5 rounded-full bg-[rgb(var(--chart-2))]"}
                        style={{ width }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </details>
    </Card>
  );
}

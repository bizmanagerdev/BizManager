import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { CashFlowTrendPoint } from "@/lib/cashflow";

const currencyFormatter = new Intl.NumberFormat("he-IL", {
  style: "currency",
  currency: "ILS",
  maximumFractionDigits: 2,
});

function formatCurrency(value: number) {
  return currencyFormatter.format(value);
}

type Props = {
  rows: CashFlowTrendPoint[];
};

export default function CashFlowTrend({ rows }: Props) {
  const maxValue = rows.reduce((max, row) => Math.max(max, row.inflow, row.outflow), 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg text-right">מגמה</CardTitle>
        <CardDescription className="text-right">
          קיבוץ תנועות לאורך זמן. טווח קצר מוצג לפי יום, וטווח ארוך לפי חודש.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            לא נמצאו תנועות עבור הסינון שנבחר.
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((row) => {
              const inflowWidth = maxValue > 0 ? `${(row.inflow / maxValue) * 100}%` : "0%";
              const outflowWidth = maxValue > 0 ? `${(row.outflow / maxValue) * 100}%` : "0%";

              return (
                <div key={row.period} className="rounded-2xl border p-4 text-right">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium">{row.period}</div>
                    <div className="text-sm text-muted-foreground">
                      נטו {formatCurrency(row.net)}
                    </div>
                  </div>
                  <div className="mt-3 space-y-2">
                    <div>
                      <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                        <span>הכנסות</span>
                        <span>{formatCurrency(row.inflow)}</span>
                      </div>
                      <div className="h-2 rounded-full bg-muted">
                        <div
                          className="h-2 rounded-full bg-[hsl(var(--chart-4))]"
                          style={{ width: inflowWidth }}
                        />
                      </div>
                    </div>
                    <div>
                      <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                        <span>הוצאות</span>
                        <span>{formatCurrency(row.outflow)}</span>
                      </div>
                      <div className="h-2 rounded-full bg-muted">
                        <div
                          className="h-2 rounded-full bg-[hsl(var(--chart-2))]"
                          style={{ width: outflowWidth }}
                        />
                      </div>
                    </div>
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

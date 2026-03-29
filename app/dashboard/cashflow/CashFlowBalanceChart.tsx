import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { CashFlowCumulativePoint } from "@/lib/cashflow";
import {
  chartPolyline,
  formatCompactCurrency,
  formatCurrency,
  formatPeriodLabel,
  scaleY,
} from "@/app/dashboard/cashflow/chart-utils";

export default function CashFlowBalanceChart({ rows }: { rows: CashFlowCumulativePoint[] }) {
  const visibleRows = rows.slice(-10);
  const chartHeight = 180;
  const chartWidth = 100;
  const step = visibleRows.length > 1 ? chartWidth / (visibleRows.length - 1) : chartWidth;
  const values = visibleRows.flatMap((row) => [row.balance, 0]);
  const maxValue = values.length > 0 ? Math.max(...values) : 0;
  const minValue = values.length > 0 ? Math.min(...values) : 0;
  const padding = Math.max((maxValue - minValue) * 0.12, 1);
  const yMin = minValue - padding;
  const yMax = maxValue + padding;
  const zeroY = scaleY(0, yMin, yMax, chartHeight);
  const linePoints = visibleRows.map((row, index) => {
    const x = visibleRows.length > 1 ? step * index : chartWidth / 2;
    const y = scaleY(row.balance, yMin, yMax, chartHeight);
    return `${x},${y}`;
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg text-right">יתרה מצטברת</CardTitle>
        <CardDescription className="text-right">
          כך נראית תנועת היתרה לאורך התקופה, כדי לזהות שחיקה או התאוששות מהר.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {visibleRows.length === 0 ? (
          <div className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            אין מספיק נתונים להצגת יתרה מצטברת.
          </div>
        ) : (
          <div className="rounded-2xl border bg-card/70 p-4">
            <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
              <span>{formatCompactCurrency(yMax)}</span>
              <span>יתרה</span>
              <span>{formatCompactCurrency(yMin)}</span>
            </div>
            <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="h-52 w-full overflow-visible">
              <line
                x1="0"
                x2={chartWidth}
                y1={zeroY}
                y2={zeroY}
                className="stroke-border"
                strokeWidth="0.75"
                vectorEffect="non-scaling-stroke"
              />
              <polyline
                fill="none"
                points={chartPolyline(linePoints)}
                stroke="hsl(var(--chart-5))"
                strokeWidth="2.5"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
              {visibleRows.map((row, index) => {
                const x = visibleRows.length > 1 ? step * index : chartWidth / 2;
                const y = scaleY(row.balance, yMin, yMax, chartHeight);
                return (
                  <circle
                    key={row.period}
                    cx={x}
                    cy={y}
                    r="1.8"
                    fill={row.balance >= 0 ? "hsl(var(--chart-5))" : "hsl(var(--chart-2))"}
                  />
                );
              })}
            </svg>
            <div className="mt-4 grid grid-cols-2 gap-3 text-right md:grid-cols-5">
              {visibleRows.map((row) => (
                <div key={`${row.period}-balance`} className="rounded-xl bg-muted/40 p-3">
                  <div className="text-xs text-muted-foreground">{formatPeriodLabel(row.period)}</div>
                  <div className={row.balance >= 0 ? "mt-1 font-medium text-emerald-700" : "mt-1 font-medium text-rose-700"}>
                    {formatCurrency(row.balance)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

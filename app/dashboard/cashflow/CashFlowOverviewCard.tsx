import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { CashFlowTrendPoint } from "@/lib/cashflow";
import {
  chartPolyline,
  formatCurrency,
  formatPeriodLabel,
  scaleY,
} from "@/app/dashboard/cashflow/chart-utils";

export default function CashFlowOverviewCard({ rows }: { rows: CashFlowTrendPoint[] }) {
  const visibleRows = rows.slice(-6);
  const chartHeight = 120;
  const chartWidth = 100;
  const step = visibleRows.length > 1 ? chartWidth / (visibleRows.length - 1) : chartWidth;
  const values = visibleRows.flatMap((row) => [row.net, 0]);
  const maxValue = values.length > 0 ? Math.max(...values) : 0;
  const minValue = values.length > 0 ? Math.min(...values) : 0;
  const span = Math.max(maxValue - minValue, 1);
  const yMin = minValue - span * 0.2;
  const yMax = maxValue + span * 0.2;
  const latest = visibleRows.at(-1) ?? null;
  const previous = visibleRows.at(-2) ?? null;
  const delta = latest && previous ? latest.net - previous.net : 0;
  const linePoints = visibleRows.map((row, index) => {
    const x = visibleRows.length > 1 ? step * index : chartWidth / 2;
    const y = scaleY(row.net, yMin, yMax, chartHeight);
    return `${x},${y}`;
  });

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1 text-right">
            <CardTitle className="text-lg">תמונת תזרים</CardTitle>
            <CardDescription>ששת המחזורים האחרונים, כדי להבין מהר אם הקצב משתפר או נחלש.</CardDescription>
          </div>
          <Link
            href="/financial"
            className="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/60"
          >
            לעמוד הכספים
            <ArrowLeft className="h-3.5 w-3.5" />
          </Link>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {visibleRows.length === 0 ? (
          <div className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            אין עדיין נתוני תזרים להצגה.
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl bg-muted/40 p-4 text-right">
                <div className="text-xs text-muted-foreground">המחזור האחרון</div>
                <div className={latest && latest.net >= 0 ? "mt-1 text-xl font-semibold text-emerald-700" : "mt-1 text-xl font-semibold text-rose-700"}>
                  {formatCurrency(latest?.net ?? 0)}
                </div>
              </div>
              <div className="rounded-2xl bg-muted/40 p-4 text-right">
                <div className="text-xs text-muted-foreground">שינוי מול המחזור הקודם</div>
                <div className={delta >= 0 ? "mt-1 text-xl font-semibold text-emerald-700" : "mt-1 text-xl font-semibold text-rose-700"}>
                  {formatCurrency(delta)}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border bg-card/70 p-4">
              <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="h-36 w-full overflow-visible">
                <polyline
                  fill="none"
                  points={chartPolyline(linePoints)}
                  stroke="hsl(var(--chart-1))"
                  strokeWidth="2.5"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
                {visibleRows.map((row, index) => {
                  const x = visibleRows.length > 1 ? step * index : chartWidth / 2;
                  const y = scaleY(row.net, yMin, yMax, chartHeight);
                  return (
                    <circle
                      key={row.period}
                      cx={x}
                      cy={y}
                      r="2"
                      fill={row.net >= 0 ? "hsl(var(--chart-5))" : "hsl(var(--chart-2))"}
                    />
                  );
                })}
              </svg>
              <div className="mt-3 grid grid-cols-3 gap-2 text-right text-xs text-muted-foreground md:grid-cols-6">
                {visibleRows.map((row) => (
                  <div key={`${row.period}-tick`}>
                    <div className="font-medium text-foreground">{formatPeriodLabel(row.period)}</div>
                    <div>{formatCurrency(row.net)}</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

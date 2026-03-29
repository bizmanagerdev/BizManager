import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { CashFlowTrendPoint } from "@/lib/cashflow";
import {
  ChartLegend,
  chartPolyline,
  formatCompactCurrency,
  formatCurrency,
  formatPeriodLabel,
  scaleY,
} from "@/app/dashboard/cashflow/chart-utils";

type Props = {
  rows: CashFlowTrendPoint[];
};

export default function CashFlowTrend({ rows }: Props) {
  const visibleRows = rows.slice(-8);
  const chartHeight = 180;
  const chartWidth = 100;
  const bandWidth = visibleRows.length > 0 ? chartWidth / visibleRows.length : chartWidth;
  const barWidth = Math.min(10, bandWidth * 0.26);
  const values = visibleRows.flatMap((row) => [row.inflow, row.outflow, row.net, 0]);
  const maxValue = values.length > 0 ? Math.max(...values) : 0;
  const minValue = values.length > 0 ? Math.min(...values) : 0;
  const rangeMax = Math.max(Math.abs(maxValue), Math.abs(minValue), 1);
  const yMin = -rangeMax;
  const yMax = rangeMax;
  const zeroY = scaleY(0, yMin, yMax, chartHeight);

  const netPoints = visibleRows.map((row, index) => {
    const x = bandWidth * index + bandWidth / 2;
    const y = scaleY(row.net, yMin, yMax, chartHeight);
    return `${x},${y}`;
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1 text-right">
            <CardTitle className="text-lg text-right">מגמת תזרים</CardTitle>
            <CardDescription className="text-right">
              הכנסות מול הוצאות בכל תקופה, עם קו נטו שמבליט מתי הכסף באמת נשאר בעסק.
            </CardDescription>
          </div>
          <ChartLegend
            items={[
              { label: "הכנסות", colorClassName: "bg-[hsl(var(--chart-4))]" },
              { label: "הוצאות", colorClassName: "bg-[hsl(var(--chart-2))]" },
              { label: "נטו", colorClassName: "bg-[hsl(var(--chart-1))]" },
            ]}
          />
        </div>
      </CardHeader>
      <CardContent>
        {visibleRows.length === 0 ? (
          <div className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            לא נמצאו תנועות עבור הסינון שנבחר.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-2xl border bg-card/70 p-4">
              <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
                <span>{formatCompactCurrency(rangeMax)}</span>
                <span>0</span>
                <span>-{formatCompactCurrency(rangeMax)}</span>
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
                {visibleRows.map((row, index) => {
                  const center = bandWidth * index + bandWidth / 2;
                  const inflowHeight = Math.max(2, zeroY - scaleY(row.inflow, yMin, yMax, chartHeight));
                  const outflowBottom = scaleY(-row.outflow, yMin, yMax, chartHeight);
                  const outflowHeight = Math.max(2, outflowBottom - zeroY);

                  return (
                    <g key={row.period}>
                      <rect
                        x={center - barWidth - 1}
                        y={zeroY - inflowHeight}
                        width={barWidth}
                        height={inflowHeight}
                        rx="1.6"
                        fill="hsl(var(--chart-4))"
                        opacity="0.9"
                      />
                      <rect
                        x={center + 1}
                        y={zeroY}
                        width={barWidth}
                        height={outflowHeight}
                        rx="1.6"
                        fill="hsl(var(--chart-2))"
                        opacity="0.9"
                      />
                    </g>
                  );
                })}
                <polyline
                  fill="none"
                  points={chartPolyline(netPoints)}
                  stroke="hsl(var(--chart-1))"
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
                {visibleRows.map((row, index) => {
                  const x = bandWidth * index + bandWidth / 2;
                  const y = scaleY(row.net, yMin, yMax, chartHeight);
                  return <circle key={`${row.period}-net`} cx={x} cy={y} r="1.6" fill="hsl(var(--chart-1))" />;
                })}
              </svg>
              <div className="mt-4 grid grid-cols-4 gap-2 text-right text-xs text-muted-foreground md:grid-cols-8">
                {visibleRows.map((row) => (
                  <div key={`${row.period}-label`} className="space-y-1">
                    <div className="font-medium text-foreground">{formatPeriodLabel(row.period)}</div>
                    <div className={row.net >= 0 ? "text-emerald-700" : "text-rose-700"}>
                      {formatCurrency(row.net)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

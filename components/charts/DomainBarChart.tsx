"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

export type DomainBarChartPoint = {
  name: string;
  inflow: number;
  outflow: number;
  /** The month before, drawn as a ghost behind. Absent = no baseline to show. */
  prevInflow?: number;
  prevOutflow?: number;
};

const ILS = new Intl.NumberFormat("he-IL", {
  style: "currency",
  currency: "ILS",
  maximumFractionDigits: 0,
});

function shortILS(value: number) {
  if (value >= 1_000_000) return `₪${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `₪${Math.round(value / 1_000)}K`;
  return `₪${Math.round(value)}`;
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border bg-background px-3 py-2 text-right text-sm shadow-md" dir="rtl">
      <div className="mb-1.5 font-semibold">{label}</div>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center justify-between gap-4">
          <span className="font-medium tabular-nums" style={{ color: entry.color }}>
            {ILS.format(entry.value)}
          </span>
          <span className="text-muted-foreground">{entry.name}</span>
        </div>
      ))}
    </div>
  );
}

export default function DomainBarChart({
  data,
  height = 260,
}: {
  data: DomainBarChartPoint[];
  /**
   * A number of px, or "100%" to fill whatever the parent gives it — the
   * dashboard card hands it a share of a column, so a fixed height there would
   * either leave white space under the axis or overflow the card.
   */
  height?: number | string;
}) {
  if (data.length === 0) return null;
  // Nothing to compare against (a first month, or a fresh install) — draw the
  // month alone rather than a row of empty ghosts and a legend explaining them.
  const hasBaseline = data.some((d) => (d.prevInflow ?? 0) > 0 || (d.prevOutflow ?? 0) > 0);

  return (
    <div dir="ltr" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 4, right: 4, left: 4, bottom: 4 }}
          barCategoryGap="30%"
          barGap={3}
        >
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgb(var(--border))" />
          {/* RTL: the categories run RIGHT to left and the value axis sits on the
              right, the way a Hebrew reader scans — left-to-right categories are
              the tell of a translated system rather than a Hebrew one. Recharts
              itself stays LTR (the wrapper is dir="ltr", which keeps its internal
              geometry and the tooltip's positioning sane); the XAxis `reversed`
              flag and the YAxis `orientation` are what turn the drawing around. */}
          <XAxis
            dataKey="name"
            reversed
            tick={{ fontSize: 11, fill: "rgb(var(--muted-foreground))" }}
            axisLine={false}
            tickLine={false}
          />
          {/* The ghosts' own axis: same categories, hidden, so both series share
              the chart's scale and its bands. Reversed too, or the two series
              would sit in opposite orders over the same labels. */}
          {hasBaseline ? <XAxis dataKey="name" xAxisId="baseline" reversed hide /> : null}
          <YAxis
            orientation="right"
            tickFormatter={shortILS}
            tick={{ fontSize: 11, fill: "rgb(var(--muted-foreground))" }}
            axisLine={false}
            tickLine={false}
            width={60}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgb(var(--muted))", opacity: 0.4 }} />
          <Legend
            formatter={(value) => (
              <span style={{ fontSize: 12, color: "rgb(var(--foreground))" }}>{value}</span>
            )}
          />
          {/* LAST MONTH, behind this one. The overlap is the trick: a second,
              hidden x-axis over the same categories gives these bars their own
              band layout, so they sit centred on the same domain instead of
              beside it. Wider and faint, they read as a watermark of where the
              month was standing — which is the only thing that makes a single
              month's bar mean anything. Declared FIRST so they paint underneath,
              and out of the legend (two entries, not four; the tooltip names
              them in full). */}
          {hasBaseline ? (
            <>
              <Bar
                xAxisId="baseline"
                dataKey="prevInflow"
                name="הכנסות · חודש קודם"
                fill="rgb(var(--success))"
                fillOpacity={0.22}
                radius={[4, 4, 0, 0]}
                maxBarSize={64}
                legendType="none"
                isAnimationActive={false}
              />
              <Bar
                xAxisId="baseline"
                dataKey="prevOutflow"
                name="הוצאות · חודש קודם"
                fill="rgb(var(--destructive))"
                fillOpacity={0.22}
                radius={[4, 4, 0, 0]}
                maxBarSize={64}
                legendType="none"
                isAnimationActive={false}
              />
            </>
          ) : null}
          <Bar dataKey="inflow" name="הכנסות" fill="rgb(var(--success))" radius={[4, 4, 0, 0]} maxBarSize={48} />
          <Bar dataKey="outflow" name="הוצאות" fill="rgb(var(--destructive))" radius={[4, 4, 0, 0]} maxBarSize={48} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

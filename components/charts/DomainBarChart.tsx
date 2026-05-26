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
  height?: number;
}) {
  if (data.length === 0) return null;

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
          <XAxis
            dataKey="name"
            tick={{ fontSize: 11, fill: "rgb(var(--muted-foreground))" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
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
          <Bar dataKey="inflow" name="הכנסות" fill="rgb(var(--success))" radius={[4, 4, 0, 0]} maxBarSize={48} />
          <Bar dataKey="outflow" name="הוצאות" fill="rgb(var(--destructive))" radius={[4, 4, 0, 0]} maxBarSize={48} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  ResponsiveContainer,
} from "recharts";

export type DomainActivityPoint = {
  name: string;
  count: number;
  net: number;
};

const ILS = new Intl.NumberFormat("he-IL", {
  style: "currency",
  currency: "ILS",
  maximumFractionDigits: 0,
});

function barColor(net: number) {
  if (net > 0) return "rgb(var(--success))";
  if (net < 0) return "rgb(var(--destructive))";
  return "rgb(var(--secondary))";
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value: number; payload: DomainActivityPoint }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-xl border bg-background px-3 py-2 text-right text-sm shadow-md" dir="rtl">
      <div className="mb-1 font-semibold">{label}</div>
      <div className="text-muted-foreground">
        {point.count} תנועות
      </div>
      <div className="mt-0.5 font-medium" style={{ color: barColor(point.net) }}>
        נטו {ILS.format(point.net)}
      </div>
    </div>
  );
}

export default function DomainActivityChart({
  data,
  height = 240,
}: {
  data: DomainActivityPoint[];
  height?: number;
}) {
  const sorted = [...data].sort((a, b) => b.count - a.count);
  if (sorted.length === 0) return null;

  return (
    <div dir="ltr" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          layout="vertical"
          data={sorted}
          margin={{ top: 4, right: 48, left: 4, bottom: 4 }}
          barCategoryGap="25%"
        >
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgb(var(--border))" />
          <XAxis
            type="number"
            tick={{ fontSize: 11, fill: "rgb(var(--muted-foreground))" }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={80}
            tick={{ fontSize: 11, fill: "rgb(var(--muted-foreground))" }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgb(var(--muted))", opacity: 0.4 }} />
          <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={32} label={{ position: "right", fontSize: 11, fill: "rgb(var(--muted-foreground))" }}>
            {sorted.map((entry, i) => (
              <Cell key={i} fill={barColor(entry.net)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

"use client";

import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type ForecastChartPoint = {
  name: string; // formatted month label
  change: number; // expected net change that month
  balance: number; // projected running balance
};

const ILS = new Intl.NumberFormat("he-IL", {
  style: "currency",
  currency: "ILS",
  maximumFractionDigits: 0,
});

function shortILS(value: number) {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}₪${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}₪${Math.round(abs / 1_000)}K`;
  return `${sign}₪${Math.round(abs)}`;
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

/** Projected cash balance over the coming months, with the per-month expected change. */
export default function ForecastChart({
  data,
  height = 280,
}: {
  data: ForecastChartPoint[];
  height?: number;
}) {
  if (data.length === 0) return null;

  return (
    <div dir="ltr" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
          <defs>
            <linearGradient id="forecastBalance" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgb(var(--primary))" stopOpacity={0.35} />
              <stop offset="100%" stopColor="rgb(var(--primary))" stopOpacity={0.03} />
            </linearGradient>
          </defs>
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
          <ReferenceLine y={0} stroke="rgb(var(--destructive))" strokeDasharray="4 4" />
          <Bar dataKey="change" name="שינוי צפוי" fill="rgb(var(--muted-foreground))" radius={[4, 4, 0, 0]} maxBarSize={28} />
          <Area
            type="monotone"
            dataKey="balance"
            name="יתרה צפויה"
            stroke="rgb(var(--primary))"
            strokeWidth={2}
            fill="url(#forecastBalance)"
            dot={{ r: 3 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

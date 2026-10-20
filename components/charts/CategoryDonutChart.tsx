"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { DonutSlice } from "./category-donut-data";

// The donut itself (recharts), loaded after the page — its box is held by
// CategoryDonut at its final size, so nothing moves when it arrives.

const ILS = new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 0 });

function SliceTooltip({ active, payload }: { active?: boolean; payload?: { payload: DonutSlice }[] }) {
  const slice = active ? payload?.[0]?.payload : undefined;
  if (!slice) return null;
  return (
    <div className="rounded-xl border bg-background px-3 py-2 text-sm shadow-md" dir="rtl">
      <div className="flex items-center gap-1.5 font-semibold">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: slice.color }} />
        {slice.label}
      </div>
      <div className="tabular-nums text-muted-foreground">
        <span dir="ltr">{ILS.format(slice.value)}</span> · {Math.round(slice.share * 100)}%
      </div>
    </div>
  );
}

export default function CategoryDonutChart({ slices }: { slices: DonutSlice[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={slices}
          dataKey="value"
          nameKey="label"
          innerRadius="62%"
          outerRadius="100%"
          startAngle={90}
          endAngle={-270}
          // A 2px surface gap between slices (the chart rules' spacer).
          stroke="#ffffff"
          strokeWidth={2}
          isAnimationActive={false}
        >
          {slices.map((slice) => (
            <Cell key={slice.label} fill={slice.color} />
          ))}
        </Pie>
        <Tooltip content={<SliceTooltip />} />
      </PieChart>
    </ResponsiveContainer>
  );
}

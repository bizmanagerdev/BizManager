"use client";

import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import type { DonutSlice } from "./category-donut-data";

// The donut itself (recharts), loaded after the page — its box is held by
// CategoryDonut at its final size, so nothing moves when it arrives. No
// floating tooltip: it landed on the total in the middle (owner, 2026-10-21).
// The slice under the pointer (or the finger) says itself in the middle
// instead — CategoryDonut's readout — and the others step back.

export default function CategoryDonutChart({
  slices,
  active,
  onActive,
  onPick,
}: {
  slices: DonutSlice[];
  /** The slice being read (its label), or null. */
  active: string | null;
  onActive: (label: string | null) => void;
  /** A slice clicked — when the slices choose something (the property page's table), not just read out. */
  onPick?: (label: string) => void;
}) {
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
          onMouseEnter={(_, index) => onActive(slices[index]?.label ?? null)}
          onMouseLeave={() => onActive(null)}
          // A tap on a phone: that slice, or back to the total — or, when the slices choose, that one chosen.
          onClick={(_, index) => {
            const label = slices[index]?.label ?? null;
            if (onPick && label) onPick(label);
            else onActive(label === active ? null : label);
          }}
        >
          {slices.map((slice) => (
            <Cell
              key={slice.label}
              fill={slice.color}
              fillOpacity={active && active !== slice.label ? 0.35 : 1}
              className="cursor-pointer outline-none"
            />
          ))}
        </Pie>
      </PieChart>
    </ResponsiveContainer>
  );
}

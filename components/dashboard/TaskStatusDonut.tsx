"use client";

import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3 } from "lucide-react";
import type { TaskStatusCounts } from "@/lib/dashboard/tasks-overview";

const numberFormatter = new Intl.NumberFormat("he-IL");

const SEGMENTS: { key: keyof TaskStatusCounts; label: string; color: string }[] = [
  { key: "todo", label: "לביצוע", color: "rgb(var(--info))" },
  { key: "in_progress", label: "בתהליך", color: "rgb(var(--warning))" },
  { key: "blocked", label: "תקוע", color: "rgb(var(--destructive))" },
  { key: "done", label: "הושלם", color: "rgb(var(--success))" },
];

/** Org-wide task-status donut + legend (לביצוע / בתהליך / תקוע / הושלם). */
export default function TaskStatusDonut({ counts }: { counts: TaskStatusCounts }) {
  const total = SEGMENTS.reduce((sum, s) => sum + counts[s.key], 0);
  if (total === 0) return null;

  const data = SEGMENTS.map((s) => ({ name: s.label, value: counts[s.key], color: s.color }));

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-lg">סטטוס משימות</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center gap-6 sm:flex-row-reverse sm:justify-between">
          <div className="relative h-44 w-44 shrink-0" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  innerRadius="64%"
                  outerRadius="100%"
                  paddingAngle={2}
                  stroke="none"
                  startAngle={90}
                  endAngle={-270}
                >
                  {data.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-bold">{numberFormatter.format(total)}</span>
              <span className="text-xs text-muted-foreground">משימות</span>
            </div>
          </div>

          <ul className="w-full max-w-xs space-y-2">
            {SEGMENTS.map((segment) => {
              const value = counts[segment.key];
              const pct = total > 0 ? Math.round((value / total) * 100) : 0;
              return (
                <li key={segment.key} className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: segment.color }}
                    />
                    <span>{segment.label}</span>
                  </span>
                  <span className="flex items-center gap-2 tabular-nums">
                    <span className="font-semibold">{numberFormatter.format(value)}</span>
                    <span className="text-muted-foreground">{pct}%</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

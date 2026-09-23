"use client";

import Link from "next/link";
import { TrendDownIcon, TrendUpIcon } from "@/components/ui/icons";
import { MetaRow } from "@/components/ui/meta-row";
import { cn } from "@/lib/utils";
import type { WeekMetric, WeekStats } from "@/lib/meetings/types";

// "מספרי השבוע" — the strip the meeting opens on. Seven days, each figure
// against the seven before it.
//
// Deliberately NOT a row of dashboard stat tiles: the arrow is the point, so
// the delta sits next to the figure rather than under it, and every card that
// HAS a page behind it is a link — the manager reads a number, doesn't believe
// it, and taps through. See the dashboard-actionable-cards rule.

function formatValue(metric: WeekMetric): string {
  if (metric.format === "currency") {
    return `${Math.round(metric.value).toLocaleString("he-IL")} ₪`;
  }
  return metric.value.toLocaleString("he-IL");
}

function formatDelta(metric: WeekMetric): { text: string; up: boolean } | null {
  if (metric.previous === null) return null;
  const diff = metric.value - metric.previous;
  if (diff === 0) return null;
  const up = diff > 0;
  const size = Math.abs(diff);
  const text =
    metric.format === "currency"
      ? `${Math.round(size).toLocaleString("he-IL")} ₪`
      : size.toLocaleString("he-IL");
  return { text, up };
}

function MetricCard({ metric }: { metric: WeekMetric }) {
  const delta = formatDelta(metric);
  // Colour the SIGN, never the figure — a whole number in green or red reads as
  // a status, which it isn't (see the no-red-green-on-whole-numbers rule).
  const good = delta ? (metric.invertTrend ? !delta.up : delta.up) : false;

  const body = (
    <>
      <div className="text-xs font-medium text-muted-foreground">{metric.label}</div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-xl font-bold leading-none">{formatValue(metric)}</span>
        {delta ? (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 text-xs font-semibold",
              good ? "text-success" : "text-destructive"
            )}
          >
            {delta.up ? <TrendUpIcon className="h-3.5 w-3.5" /> : <TrendDownIcon className="h-3.5 w-3.5" />}
            {delta.text}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">ללא שינוי</span>
        )}
      </div>
      {metric.caption ? (
        <div className="mt-1 text-[0.6875rem] leading-snug text-muted-foreground">{metric.caption}</div>
      ) : null}
      {metric.captionNote ? (
        <div className="mt-0.5 text-[0.6875rem] font-medium leading-snug text-warning-soft-foreground">
          {metric.captionNote}
        </div>
      ) : null}
    </>
  );

  const className = cn(
    "rounded-2xl border border-border/70 bg-card/80 p-3 shadow-sm",
    metric.href && "transition-colors hover:border-secondary/50 hover:bg-secondary/5"
  );

  if (!metric.href) return <div className={className}>{body}</div>;
  return (
    <Link href={metric.href} className={cn(className, "block")}>
      {body}
    </Link>
  );
}

function formatRange(from: string, to: string): string {
  const day = (iso: string) => {
    const [, m, d] = iso.split("-");
    return `${d}/${m}`;
  };
  return `${day(from)} – ${day(to)}`;
}

export function WeekNumbers({ stats, frozen }: { stats: WeekStats; frozen: boolean }) {
  // The period is the gap since the last meeting, so it is only "השבוע" when it
  // genuinely was one. After a skipped fortnight the strip says so, in the
  // heading and in what it claims to be comparing against — a 21-day figure
  // labelled "this week" against "last week" would flatter every number on it.
  const isWeek = stats.days === 7;
  const heading = isWeek ? "מספרי השבוע" : `מספרי התקופה — ${stats.days} ימים`;
  const comparison = frozen
    ? "כפי שנרשמו בישיבה"
    : isWeek
      ? "לעומת השבוע שלפניו"
      : `לעומת ${stats.days} הימים שלפניהם`;

  return (
    <section className="space-y-2" aria-label={heading}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold">{heading}</h2>
        <MetaRow
          className="text-xs text-muted-foreground"
          items={[formatRange(stats.from, stats.to), comparison]}
        />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        {stats.metrics.map((metric) => (
          <MetricCard key={metric.key} metric={metric} />
        ))}
      </div>
    </section>
  );
}

export default WeekNumbers;

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Reference-style stat card: icon, small label, big colored value, optional
 * badges/sub-lines, a ruled list of label→value details, and an optional
 * full-width action pinned to the bottom.
 *
 * Lives here because the order page and the project page state their money the
 * same way — one card that says what the payment situation is, the figures
 * behind it, and the one thing you can do about it.
 */
export function StatActionCard({
  icon,
  label,
  value,
  valueClassName,
  badges,
  subtitles,
  details,
  children,
  action,
  className,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  valueClassName?: string;
  badges?: React.ReactNode;
  subtitles?: (string | null)[];
  details?: { label: string; value: React.ReactNode }[];
  /** Free-form content under the details rows, for cards that need more than
   *  label→value pairs (a list, a note). Shares the same ruled separator. */
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  const subs = (subtitles ?? []).filter((line): line is string => Boolean(line));
  return (
    <div
      className={cn(
        // h-full: the three cards in a row are one block, so they share the
        // tallest one's height and their buttons land on the same line.
        "flex h-full flex-col gap-2.5 rounded-3xl border border-border/70 bg-card/80 p-3.5 shadow-sm",
        className
      )}
    >
      <div className="flex items-start gap-2.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-xs font-medium text-muted-foreground">{label}</div>
          <div className="flex flex-wrap items-center gap-2">
            {typeof value === "string" ? (
              <div className={cn("text-lg font-bold leading-snug", valueClassName)}>{value}</div>
            ) : (
              value
            )}
            {badges}
          </div>
          {subs.map((line) => (
            <div key={line} className="text-xs text-muted-foreground">
              {line}
            </div>
          ))}
        </div>
      </div>
      {details && details.length > 0 ? (
        <div className="space-y-1 border-t border-border/50 pt-2">
          {details.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-2 text-xs">
              <span className="shrink-0 text-muted-foreground">{row.label}</span>
              <span className="min-w-0 text-end font-medium">{row.value}</span>
            </div>
          ))}
        </div>
      ) : null}
      {children ? (
        <div
          className={
            details && details.length > 0 ? undefined : "border-t border-border/50 pt-2"
          }
        >
          {children}
        </div>
      ) : null}
      {action ? <div className="mt-auto">{action}</div> : null}
    </div>
  );
}

/** Text-only color for a collection status (no badge pill). */
export function collectionStatusTextClass(status: string) {
  switch (status) {
    case "overpaid":
      return "text-destructive";
    case "collected":
      return "text-success-soft-foreground";
    case "partial":
      return "text-info-soft-foreground";
    case "awaiting":
      return "text-primary";
    default:
      return "text-destructive";
  }
}

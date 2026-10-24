"use client";

import Link from "next/link";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { HighlightAll, MatchReason, highlightText } from "@/components/search/highlightMatch";
import { formatShortDate } from "@/lib/date";
import { formatCurrencyAmount } from "@/lib/money";
import type { GlobalSearchReason, GlobalSearchResponse, GlobalSearchResult } from "@/lib/global-search";
import type { UnderstoodPart } from "@/lib/search/global-query";
import { cn } from "@/lib/utils";

// The global search's results, as one list for both places it shows: the
// top-bar box (compact) and the full /search page. Every result says what it
// is, why it came up (the matching field, painted yellow) and links to the
// record itself.

function understoodText(part: UnderstoodPart) {
  // With no currency typed an amount is looked for in ₪, $ and C$ alike: no sign.
  if (part.kind === "amount") {
    const value = Number(part.value);
    return `סכום ${part.currency ? formatCurrencyAmount(value, part.currency) : value.toLocaleString("he-IL")}`;
  }
  if (part.kind === "date") return `תאריך ${formatShortDate(part.value, part.value)}`;
  if (part.kind === "hour") return `שעה ${part.value}`;
  return `טלפון ${part.value}`;
}

/**
 * The reasons worth a line under a result that also shows its chips: an amount
 * already painted as a chip isn't said twice; a date stays, since its label
 * says WHICH date it was (opened, paid, delivered…).
 */
export function visibleReasons(result: Pick<GlobalSearchResult, "reasons" | "meta">): GlobalSearchReason[] {
  return result.reasons.filter(
    (reason) => !(reason.kind === "amount" && result.meta.some((item) => item.hit && item.text === reason.value))
  );
}

export function searchHref(query: string, kind?: string | null) {
  const params = new URLSearchParams({ q: query });
  if (kind) params.set("kind", kind);
  return `/search?${params.toString()}`;
}

function ResultRow({
  result,
  terms,
  compact,
  onNavigate,
}: {
  result: GlobalSearchResult;
  terms: string[];
  compact: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={result.href}
      className={cn(
        "block transition-colors",
        compact ? "rounded-2xl px-3 py-2.5 hover:bg-muted/60" : "rounded-2xl border border-border/70 p-4 hover:bg-muted/40"
      )}
      onClick={() => {
        emitNavigationStart();
        onNavigate?.();
      }}
    >
      <div className="min-w-0 space-y-1">
        <div className={cn("font-medium", compact ? "text-sm" : "text-base")}>{highlightText(result.title, terms)}</div>
        {result.subtitle ? (
          <div className={cn("text-muted-foreground", compact ? "text-xs" : "text-sm")}>
            {highlightText(result.subtitle, terms)}
          </div>
        ) : null}
        {visibleReasons(result).map((reason) => (
          <MatchReason
            key={`${reason.kind}:${reason.label}`}
            label={reason.label}
            value={reason.value}
            terms={terms}
            whole={reason.kind !== "text"}
            className={cn("text-muted-foreground/90", compact ? "text-xs" : "text-sm")}
          />
        ))}
      </div>
      {result.meta.length > 0 ? (
        <div className={cn("flex flex-wrap gap-1.5 text-muted-foreground", compact ? "mt-1.5 text-[0.647rem]" : "mt-3 text-xs")}>
          {result.meta.slice(0, compact ? 3 : 6).map((item) => (
            <span
              key={item.text}
              className={cn(
                "rounded-full px-2 py-0.5 tabular-nums",
                item.hit ? "bg-yellow-200/90 text-foreground dark:bg-yellow-500/35" : compact ? "bg-muted/70" : "bg-muted"
              )}
            >
              {item.hit ? item.text : highlightText(item.text, terms)}
            </span>
          ))}
        </div>
      ) : null}
    </Link>
  );
}

export function GlobalSearchResults({
  results,
  compact = false,
  onNavigate,
  showAllKind,
}: {
  results: GlobalSearchResponse;
  compact?: boolean;
  onNavigate?: () => void;
  /** On the "show all" view of one group: that group, with a way back. */
  showAllKind?: string | null;
}) {
  const { query, terms } = results;

  return (
    <div className={compact ? "" : "space-y-4"}>
      <div
        className={cn(
          "flex flex-wrap items-center gap-x-3 gap-y-1.5",
          compact ? "border-b border-border/70 px-4 py-2.5 text-xs" : "text-sm"
        )}
      >
        <span className="font-medium text-muted-foreground">
          {results.totalResults.toLocaleString("he-IL")} תוצאות
        </span>
        {results.understood.map((part) => (
          <span key={`${part.kind}:${part.value}`} className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
            <HighlightAll>{understoodText(part)}</HighlightAll>
          </span>
        ))}
        {results.corrections.length > 0 ? (
          <span className="text-muted-foreground">
            גם בכתיב דומה: {results.corrections.slice(0, 3).join(", ")}
          </span>
        ) : null}
        {showAllKind ? (
          <Link href={searchHref(query)} className="text-primary underline-offset-2 hover:underline" onClick={() => emitNavigationStart()}>
            חזרה לכל סוגי התוצאות
          </Link>
        ) : null}
      </div>

      <div className={compact ? "space-y-1 p-2" : "grid grid-cols-1 gap-4 xl:grid-cols-2"}>
        {results.groups.map((group) => (
          <section
            key={group.key}
            className={compact ? "space-y-0.5" : "space-y-2 rounded-3xl border border-border/60 bg-card p-4 shadow-sm"}
          >
            <div className={cn("flex items-baseline justify-between gap-2", compact ? "px-2 pt-2" : "pb-1")}>
              <div
                className={cn(
                  "font-semibold",
                  compact ? "text-[0.647rem] uppercase tracking-[0.18em] text-muted-foreground" : "text-lg"
                )}
              >
                {group.label}
                <span className="ms-1.5 font-normal text-muted-foreground">{group.total.toLocaleString("he-IL")}</span>
              </div>
              {group.total > group.results.length ? (
                <Link
                  href={searchHref(query, group.key)}
                  className={cn("shrink-0 text-primary underline-offset-2 hover:underline", compact ? "text-[0.7rem]" : "text-sm")}
                  onClick={() => {
                    emitNavigationStart();
                    onNavigate?.();
                  }}
                >
                  הצג את כל {group.total.toLocaleString("he-IL")}
                </Link>
              ) : null}
            </div>
            <div className={compact ? "space-y-0.5" : "space-y-2"}>
              {group.results.map((result) => (
                <ResultRow
                  key={`${result.group}:${result.id}`}
                  result={result}
                  terms={terms}
                  compact={compact}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

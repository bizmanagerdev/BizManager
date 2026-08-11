"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SearchIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ViewDialog } from "@/components/ui/view-dialog";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { getProjectStatusLabel } from "@/lib/ui/status-colors";
import { cn } from "@/lib/utils";
import { highlightText, MatchReason } from "@/components/search/highlightMatch";
import { useCustomerSearchIndex } from "@/hooks/useCustomerSearchIndex";
import type { GlobalSearchResponse } from "@/lib/global-search";

type Props = {
  className?: string;
  desktopOnly?: boolean;
  mobileOnly?: boolean;
  /**
   * Render the mobile trigger as a single glyph in the icon cluster instead of a
   * full-width bar. Used when the header's middle slot is taken by the page
   * title — search stays one tap away rather than disappearing on a phone.
   */
  iconOnly?: boolean;
};

function translateSearchMetaItem(value: string) {
  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case "moving":
      return "הובלה";
    case "construction":
      return "שיפוצים";
    case "logistics":
      return "לוגיסטיקה";
    case "completed":
    case "active":
    case "planned":
    case "planning":
    case "on_hold":
    case "quote":
    case "cancelled":
      return getProjectStatusLabel(normalized);
    default:
      return value;
  }
}

function SearchResults({
  results,
  query,
  compact = false,
  offline = false,
  onNavigate,
}: {
  results: GlobalSearchResponse | null;
  query: string;
  compact?: boolean;
  offline?: boolean;
  onNavigate?: () => void;
}) {
  const trimmedQuery = query.trim();

  if (!trimmedQuery) {
    return (
      <div className="px-4 py-6 text-sm text-muted-foreground">
        חפשו לקוחות, פרויקטים, משימות, הזמנות, מוצרים, מסמכים, מלאי ופיננסים.
      </div>
    );
  }

  if (trimmedQuery.length < 2) {
    return <div className="px-4 py-6 text-sm text-muted-foreground">הקלידו לפחות 2 תווים.</div>;
  }

  if (!results) {
    return <div className="px-4 py-6 text-sm text-muted-foreground">מחפש...</div>;
  }

  if (results.totalResults === 0) {
    return (
      <div className="px-4 py-6 text-sm text-muted-foreground">
        {offline ? "לא מקוון — לא נמצא לקוח תואם ברשימה השמורה." : "לא נמצאו תוצאות."}
      </div>
    );
  }

  return (
    <div className="max-h-[min(70vh,40rem)] overflow-y-auto">
      {offline ? (
        <div className="flex items-center gap-1.5 border-b border-warning/40 bg-warning-soft/60 px-4 py-2 text-xs text-warning-soft-foreground">
          <span>לא מקוון — מציג לקוחות מהרשימה השמורה במכשיר בלבד.</span>
        </div>
      ) : null}
      <div className="border-b border-border/70 px-4 py-3 text-xs font-medium text-muted-foreground">
        {results.totalResults} תוצאות
      </div>
      <div className="space-y-1 p-2">
        {results.groups.map((group) => (
          <section key={group.key} className="space-y-1">
            <div className="px-2 pt-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {group.label}
            </div>
            {group.results.map((result) => (
              <Link
                key={`${result.group}:${result.id}`}
                href={result.href}
                className="block rounded-2xl px-3 py-3 transition-colors hover:bg-muted/60"
                onClick={() => {
                  emitNavigationStart();
                  onNavigate?.();
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="truncate text-sm font-medium">{highlightText(result.title, trimmedQuery)}</div>
                    {result.subtitle ? (
                      <div className="truncate text-xs text-muted-foreground">
                        {highlightText(result.subtitle, trimmedQuery)}
                      </div>
                    ) : null}
                    {result.match ? (
                      <MatchReason
                        label={result.match.label}
                        snippet={result.match.snippet}
                        query={trimmedQuery}
                        className="truncate text-xs text-muted-foreground/90"
                      />
                    ) : null}
                  </div>
                  {!compact ? (
                    <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground">
                      {result.groupLabel}
                    </span>
                  ) : null}
                </div>
                {result.meta.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                    {result.meta.slice(0, compact ? 2 : 3).map((item) => {
                      const translated = translateSearchMetaItem(item);
                      return (
                        <span key={`${item}-${translated}`} className="rounded-full bg-background/80 px-2 py-1">
                          {translated}
                        </span>
                      );
                    })}
                  </div>
                ) : null}
              </Link>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

export function GlobalSearch({ className, desktopOnly = false, mobileOnly = false, iconOnly = false }: Props) {
  const router = useRouter();
  const { search: searchCustomers } = useCustomerSearchIndex();
  const desktopRef = useRef<HTMLDivElement | null>(null);
  const mobileInputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [fetchedResults, setFetchedResults] = useState<GlobalSearchResponse | null>(null);
  const [offlineFallback, setOfflineFallback] = useState(false);
  const [open, setOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const deferredQuery = useDeferredValue(debouncedQuery);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedQuery(query);
    }, 250);

    return () => window.clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    if (mobileOpen) {
      window.setTimeout(() => mobileInputRef.current?.focus(), 20);
    }
  }, [mobileOpen]);

  useEffect(() => {
    const normalized = deferredQuery.trim();
    if (!normalized || normalized.length < 2) return;

    // Offline / server unreachable → search the cached customer directory in
    // memory so the global bar still finds and links customers with no signal.
    const showOfflineResults = () => {
      const matched = searchCustomers(normalized, 8);
      const results = matched.map((c) => ({
        id: c.id,
        group: "customers" as const,
        groupLabel: "לקוחות",
        title: c.name,
        subtitle: c.address || null,
        meta: [c.phone, c.email].filter((v): v is string => Boolean(v)),
        href: `/customers/${encodeURIComponent(c.id)}`,
      }));
      setFetchedResults({
        query: normalized,
        totalResults: results.length,
        groups: results.length ? [{ key: "customers", label: "לקוחות", results }] : [],
      });
      setOfflineFallback(true);
    };

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      showOfflineResults();
      return;
    }

    const controller = new AbortController();

    void fetch(`/api/search/global?q=${encodeURIComponent(normalized)}&limit=4&mode=quick`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const json = (await response.json().catch(() => null)) as GlobalSearchResponse | null;
        if (!response.ok) throw new Error("החיפוש נכשל.");
        setFetchedResults(json);
        setOfflineFallback(false);
      })
      .catch((error: unknown) => {
        if ((error as { name?: string })?.name === "AbortError") return;
        // Network failed mid-flight — fall back to the cached customer directory.
        showOfflineResults();
      });

    return () => controller.abort();
  }, [deferredQuery, searchCustomers]);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!desktopRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const searchHref = useMemo(() => {
    const normalized = query.trim();
    return normalized ? `/search?q=${encodeURIComponent(normalized)}` : "/search";
  }, [query]);

  const normalizedQuery = query.trim();
  const results =
    normalizedQuery.length >= 2 && fetchedResults?.query === normalizedQuery
      ? fetchedResults
      : null;

  function submitSearch() {
    emitNavigationStart();
    setOpen(false);
    setMobileOpen(false);
    router.push(searchHref);
  }

  return (
    <>
      {!mobileOnly ? (
        <div ref={desktopRef} className={cn("relative hidden flex-1 lg:flex", className)}>
          <div className="relative w-full">
            <SearchIcon className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-sidebar-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onFocus={() => setOpen(true)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitSearch();
                }
                if (event.key === "Escape") {
                  setOpen(false);
                }
              }}
              placeholder="חיפוש בכל המערכת..."
              // Recessed into the dark top bar rather than a bright white box:
              // search is a tool you reach for, not the first thing that should
              // grab the eye. Lifts slightly on hover/focus.
              className="h-10 rounded-xl border-white/10 bg-white/[0.06] ps-9 text-sidebar-foreground shadow-none transition-colors placeholder:text-sidebar-foreground/60 hover:bg-white/[0.1] focus-visible:bg-white/[0.12] focus-visible:ring-1 focus-visible:ring-white/25"
            />
          </div>
          {open ? (
            <div className="absolute inset-x-0 top-[calc(100%+0.6rem)] z-50 overflow-hidden rounded-[1.4rem] border border-border/60 bg-background/95 shadow-elevated backdrop-blur-xl">
              <SearchResults results={results} query={query} offline={offlineFallback} onNavigate={() => setOpen(false)} />
              {query.trim().length >= 2 ? (
                <div className="border-t border-border/70 p-2">
                  <Button variant="ghost" className="w-full justify-center rounded-xl" onClick={submitSearch}>
                    לכל התוצאות
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {!desktopOnly ? (
        // A real search BAR on mobile, not a lone glyph — it reads as "type here".
        // Tapping it opens the full-screen dialog below, which is a far better
        // place for results on a phone than an inline dropdown would be. The bar
        // needs the header's middle slot, so when the page title has taken that
        // (iconOnly) it falls back to a glyph in the icon cluster.
        <Button
          variant="ghost"
          size={iconOnly ? "icon-sm" : undefined}
          aria-label={iconOnly ? "חיפוש" : undefined}
          className={cn(
            iconOnly
              ? "shrink-0 text-sidebar-foreground/70 hover:text-sidebar-foreground lg:hidden"
              : "h-10 w-full justify-start gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3 font-normal text-sidebar-foreground/60 shadow-none hover:bg-white/[0.1] hover:text-sidebar-foreground lg:hidden",
            className
          )}
          type="button"
          onClick={() => setMobileOpen(true)}
        >
          <SearchIcon className="h-4 w-4 shrink-0" />
          {iconOnly ? null : <span>חיפוש...</span>}
        </Button>
      ) : null}

      {!desktopOnly ? (
        <ViewDialog
          open={mobileOpen}
          onOpenChange={setMobileOpen}
          title="חיפוש גלובלי"
          description="מצאו כל דבר במערכת ממקום אחד."
          size="form2xl"
          bodyClassName="p-0 sm:p-0"
          headerBelow={
            <div className="relative">
              <SearchIcon className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={mobileInputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    submitSearch();
                  }
                }}
                placeholder="חיפוש בכל המערכת..."
                className="ps-9"
              />
            </div>
          }
          footer={
            query.trim().length >= 2 ? (
              <Button className="w-full rounded-xl" onClick={submitSearch}>
                לכל התוצאות
              </Button>
            ) : null
          }
        >
          <SearchResults
            results={results}
            query={query}
            compact
            offline={offlineFallback}
            onNavigate={() => setMobileOpen(false)}
          />
        </ViewDialog>
      ) : null}
    </>
  );
}

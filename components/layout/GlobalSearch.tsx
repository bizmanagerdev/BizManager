"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SearchIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ViewDialog } from "@/components/ui/view-dialog";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { TOPBAR_ICON_BUTTON } from "@/components/layout/topbar-icon";
import { cn } from "@/lib/utils";
import { GlobalSearchResults, searchHref } from "@/components/search/GlobalSearchResults";
import { useCustomerSearchIndex } from "@/hooks/useCustomerSearchIndex";
import type { GlobalSearchResponse } from "@/lib/global-search";
import { gsNorm } from "@/lib/search/global-query";
import { takeQuickParam } from "@/lib/quick-link";

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

// What the box can find, said once before anything is typed.
const SEARCH_HINT =
  "כל דבר במערכת: שם, מילה מהערה או מתגובה, סכום (1000), תאריך (15/10), טלפון, סניף, מסמך, רכב, הוצאה, הכנסה…";

function SearchResults({
  results,
  query,
  loading = false,
  offline = false,
  onNavigate,
}: {
  results: GlobalSearchResponse | null;
  query: string;
  loading?: boolean;
  offline?: boolean;
  onNavigate?: () => void;
}) {
  const trimmedQuery = query.trim();

  if (!trimmedQuery) {
    return <div className="px-4 py-6 text-sm text-muted-foreground">{SEARCH_HINT}</div>;
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
    <div className={cn("max-h-[min(70vh,40rem)] overflow-y-auto transition-opacity", loading && "opacity-60")}>
      {offline ? (
        <div className="flex items-center gap-1.5 border-b border-warning/40 bg-warning-soft/60 px-4 py-2 text-xs text-warning-soft-foreground">
          <span>לא מקוון — מציג לקוחות מהרשימה השמורה במכשיר בלבד.</span>
        </div>
      ) : null}
      <GlobalSearchResults results={results} compact onNavigate={onNavigate} />
    </div>
  );
}

export function GlobalSearch({ className, desktopOnly = false, mobileOnly = false, iconOnly = false }: Props) {
  const router = useRouter();
  // Only the offline fallback below reads it, so it loads once the page is idle.
  const { search: searchCustomers } = useCustomerSearchIndex({ deferUntilIdle: true });
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

  // The phone app's "חיפוש" shortcut (/dashboard?quick=search): open with the
  // box ready to type in. A one-time read of the address on mount.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (takeQuickParam(["search"] as const)) setMobileOpen(true);
  }, []);

  useEffect(() => {
    const normalized = deferredQuery.trim();
    if (!normalized || normalized.length < 2) return;

    // Offline / server unreachable → search the cached customer directory in
    // memory so the global bar still finds and links customers with no signal.
    const showOfflineResults = () => {
      const matched = searchCustomers(normalized, 8);
      const results = matched.map((c) => ({
        id: c.id,
        group: "customer" as const,
        groupLabel: "לקוחות",
        title: c.name,
        subtitle: c.address || null,
        meta: [c.phone, c.email].filter((v): v is string => Boolean(v)).map((text) => ({ text })),
        href: `/customers/${encodeURIComponent(c.id)}`,
        reasons: [],
        rank: 3,
      }));
      setFetchedResults({
        query: normalized,
        totalResults: results.length,
        terms: gsNorm(normalized).split(" ").filter(Boolean),
        understood: [],
        corrections: [],
        groups: results.length ? [{ key: "customer", label: "לקוחות", total: results.length, results }] : [],
      });
      setOfflineFallback(true);
    };

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      showOfflineResults();
      return;
    }

    const controller = new AbortController();

    // Eight per kind here — three hid what the owner was looking for: a find by
    // the name for invoices ("נחל" → בית כנסת ברסלב, "ברכת הנחל") ranks below
    // the names that hold the word, and sat behind "הצג את כל" (2026-10-19).
    // "הצג את כל N" and "לכל התוצאות" still open the full page for more.
    void fetch(`/api/search/global?q=${encodeURIComponent(normalized)}&limit=8`, {
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

  const fullSearchHref = useMemo(() => {
    const normalized = query.trim();
    return normalized ? searchHref(normalized) : "/search";
  }, [query]);

  const normalizedQuery = query.trim();
  // While the next answer is on its way the last one stays on screen, dimmed,
  // instead of the list blinking to "מחפש…" on every keystroke.
  const results = normalizedQuery.length >= 2 ? fetchedResults : null;
  const loading = Boolean(results) && results?.query !== normalizedQuery;

  function submitSearch() {
    emitNavigationStart();
    setOpen(false);
    setMobileOpen(false);
    router.push(fullSearchHref);
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
            <div className="absolute inset-x-0 top-[calc(100%+0.6rem)] z-50 overflow-hidden rounded-[1.4rem] border border-border/60 bg-background/95 shadow-elevated">
              <SearchResults
                results={results}
                query={query}
                loading={loading}
                offline={offlineFallback}
                onNavigate={() => setOpen(false)}
              />
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
        // place for results on a phone than an inline dropdown would be.
        //
        // `iconOnly` is the glyph-in-the-icon-cluster form, and it is NOT
        // lg:hidden: the top bar now uses it at every width (the 20rem desktop box
        // was dropped, and the bar's middle slot went to the page title), so one
        // magnifier opens the same dialog on a phone and on a desktop.
        <Button
          variant="ghost"
          size={iconOnly ? "icon-sm" : undefined}
          aria-label={iconOnly ? "חיפוש" : undefined}
          className={cn(
            // The glyph form IS a top-bar icon button — same 40px circle, same
            // light hover as the bell and the back arrow. It used to carry its
            // own classes and fell back to the plain ghost variant, so it was
            // the one control up there with a different shape and a different
            // hover (user, 2026-08-19).
            iconOnly
              ? cn("shrink-0", TOPBAR_ICON_BUTTON)
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
                placeholder="שם, סכום, תאריך, טלפון, מילה מהערה..."
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
            loading={loading}
            offline={offlineFallback}
            onNavigate={() => setMobileOpen(false)}
          />
        </ViewDialog>
      ) : null}
    </>
  );
}

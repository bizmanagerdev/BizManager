"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { cn } from "@/lib/utils";
import type { GlobalSearchResponse } from "@/lib/global-search";

type Props = {
  className?: string;
  desktopOnly?: boolean;
  mobileOnly?: boolean;
};

function SearchResults({
  results,
  query,
  compact = false,
  onNavigate,
}: {
  results: GlobalSearchResponse | null;
  query: string;
  compact?: boolean;
  onNavigate?: () => void;
}) {
  if (!query.trim()) {
    return (
      <div className="px-4 py-6 text-sm text-muted-foreground">
        חפשו לקוחות, פרויקטים, משימות, הזמנות, מוצרים, מסמכים, מלאי ופיננסים.
      </div>
    );
  }

  if (!results) {
    return <div className="px-4 py-6 text-sm text-muted-foreground">מחפש...</div>;
  }

  if (results.totalResults === 0) {
    return <div className="px-4 py-6 text-sm text-muted-foreground">לא נמצאו תוצאות.</div>;
  }

  return (
    <div className="max-h-[min(70vh,40rem)] overflow-y-auto">
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
                    <div className="truncate text-sm font-medium">{result.title}</div>
                    {result.subtitle ? (
                      <div className="truncate text-xs text-muted-foreground">{result.subtitle}</div>
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
                    {result.meta.slice(0, compact ? 2 : 3).map((item) => (
                      <span key={item} className="rounded-full bg-background/80 px-2 py-1">
                        {item}
                      </span>
                    ))}
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

export function GlobalSearch({ className, desktopOnly = false, mobileOnly = false }: Props) {
  const router = useRouter();
  const desktopRef = useRef<HTMLDivElement | null>(null);
  const mobileInputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [fetchedResults, setFetchedResults] = useState<GlobalSearchResponse | null>(null);
  const [open, setOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    if (mobileOpen) {
      window.setTimeout(() => mobileInputRef.current?.focus(), 20);
    }
  }, [mobileOpen]);

  useEffect(() => {
    const normalized = deferredQuery.trim();
    if (!normalized) return;

    const controller = new AbortController();

    void fetch(`/api/search/global?q=${encodeURIComponent(normalized)}&limit=4`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const json = (await response.json().catch(() => null)) as GlobalSearchResponse | null;
        if (!response.ok) throw new Error("Global search failed");
        setFetchedResults(json);
      })
      .catch((error: unknown) => {
        if ((error as { name?: string })?.name === "AbortError") return;
        setFetchedResults({ query: normalized, totalResults: 0, groups: [] });
      });

    return () => controller.abort();
  }, [deferredQuery]);

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
    normalizedQuery && fetchedResults?.query === normalizedQuery ? fetchedResults : null;

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
            <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
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
              className="h-10 rounded-xl border-white/50 bg-white/70 ps-9 shadow-sm shadow-primary/5 focus-visible:ring-2"
            />
          </div>
          {open ? (
            <div className="absolute inset-x-0 top-[calc(100%+0.6rem)] z-50 overflow-hidden rounded-[1.4rem] border border-white/60 bg-background/95 shadow-elevated backdrop-blur-xl">
              <SearchResults results={results} query={query} onNavigate={() => setOpen(false)} />
              {query.trim() ? (
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
        <Button
          variant="ghost"
          size="icon-sm"
          className={cn("rounded-xl border-primary/15 text-accent-foreground shadow-md lg:hidden", className)}
          type="button"
          onClick={() => setMobileOpen(true)}
        >
          <Search className="h-4 w-4" />
        </Button>
      ) : null}

      {!desktopOnly ? (
        <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
          <DialogContent className="w-[calc(100vw-1rem)] max-w-2xl rounded-[1.5rem] border-white/60 p-0">
            <div className="border-b border-border/70 p-4">
              <DialogTitle className="text-right">חיפוש גלובלי</DialogTitle>
              <DialogDescription className="mt-1 text-right">
                מצאו כל דבר במערכת ממקום אחד.
              </DialogDescription>
              <div className="relative mt-4">
                <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
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
            </div>
            <SearchResults results={results} query={query} compact onNavigate={() => setMobileOpen(false)} />
            {query.trim() ? (
              <div className="border-t border-border/70 p-3">
                <Button className="w-full rounded-xl" onClick={submitSearch}>
                  לכל התוצאות
                </Button>
              </div>
            ) : null}
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

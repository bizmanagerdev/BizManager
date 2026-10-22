"use client";

// A page's search over its own list (owner, 2026-10-22: "the search bar doesn't
// need to span across the whole page"): 24rem on a computer (PAGE_SEARCH_WIDTH,
// room for the longest hint) — never the page's whole width — full width on a
// phone, and saying what it searches ("חיפוש בנכסים…"), so it never passes for
// the search for everything in the middle of the top bar. A search that finds nothing offers that one instead
// (SearchEverywhereLink — NN/g's advice for a search with a narrower scope).

import Link from "next/link";
import { Input } from "@/components/ui/input";
import { SearchIcon } from "@/components/ui/icons";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { searchHref } from "@/components/search/GlobalSearchResults";
import { cn } from "@/lib/utils";

/** Every page search's width from md up — the pages that build their own box use it too. */
export const PAGE_SEARCH_WIDTH = "w-full md:w-96";

export function ListSearch({
  value,
  onChange,
  placeholder,
  label,
  className,
  inputClassName,
}: {
  value: string;
  onChange: (value: string) => void;
  /** What it searches, in its words: "חיפוש בהזמנות…". */
  placeholder: string;
  /** Its name for a screen reader, when the placeholder says more than that. */
  label?: string;
  className?: string;
  inputClassName?: string;
}) {
  return (
    <div className={cn("relative min-w-0", PAGE_SEARCH_WIDTH, className)}>
      <SearchIcon className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        className={cn("h-10 ps-9", inputClassName)}
      />
    </div>
  );
}

/** Under a page search that found nothing: the same words, searched everywhere. */
export function SearchEverywhereLink({ query, className }: { query: string; className?: string }) {
  const q = query.trim();
  if (q.length < 2) return null;
  return (
    <Link
      href={searchHref(q)}
      onClick={() => emitNavigationStart()}
      className={cn("text-sm font-medium text-secondary hover:underline", className)}
    >
      לחפש ״{q}״ בכל המערכת
    </Link>
  );
}

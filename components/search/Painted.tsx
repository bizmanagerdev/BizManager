"use client";

import { createContext, useContext, type ReactNode } from "react";
import { highlightText } from "@/components/search/highlightMatch";
import { SearchMatchLine } from "@/components/search/SearchMatchLine";
import type { GlobalSearchReason } from "@/lib/global-search";

// A list's search words, set once around the list, so every bit of text in its
// rows — a name, a phone, a date, an amount — can paint what matched without
// each little cell being handed the search (owner, 2026-10-19: "it should
// paint whatever it found matching so I understand").

const SearchTermsContext = createContext<readonly string[] | null>(null);

export function SearchTermsProvider({ terms, children }: { terms: readonly string[] | null; children: ReactNode }) {
  return <SearchTermsContext.Provider value={terms && terms.length > 0 ? terms : null}>{children}</SearchTermsContext.Provider>;
}

/** `text`, with what the search around it matched painted yellow. */
export function Painted({ text }: { text: string | null | undefined }) {
  const terms = useContext(SearchTermsContext);
  if (!text) return null;
  return <>{terms ? highlightText(text, terms) : text}</>;
}

/** Why a row came up, for what it doesn't show — only while a search is on. */
export function SearchReasons({
  reasons,
  hideLabels,
  className,
}: {
  reasons: readonly GlobalSearchReason[] | undefined;
  hideLabels?: readonly string[];
  className?: string;
}) {
  const terms = useContext(SearchTermsContext);
  if (!terms) return null;
  return <SearchMatchLine reasons={reasons} terms={terms} hideLabels={hideLabels} className={className} />;
}

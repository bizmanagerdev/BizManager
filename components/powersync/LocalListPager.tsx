"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { InfinitePage } from "@/hooks/useInfiniteScroll";

// A list's further pages from the on-device copy. The device version of a page
// (e.g. LocalSalesPage) provides it around the same list component the server
// version renders; that component's fetch-as-you-scroll asks it for page 2, 3…
// instead of the server when it's there (useLocalListPager).

type PageFetcher = (page: number) => Promise<InfinitePage<unknown>>;

const LocalListPagerContext = createContext<PageFetcher | null>(null);

export function LocalListPagerProvider({ fetchPage, children }: { fetchPage: PageFetcher; children: ReactNode }) {
  return <LocalListPagerContext.Provider value={fetchPage}>{children}</LocalListPagerContext.Provider>;
}

/** The device's page fetcher for this list, or null on the server version. */
export function useLocalListPager<T>(): ((page: number) => Promise<InfinitePage<T>>) | null {
  return useContext(LocalListPagerContext) as ((page: number) => Promise<InfinitePage<T>>) | null;
}

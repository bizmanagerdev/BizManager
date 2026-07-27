"use client";

// Lets a page tell the top bar what it is, so the MOBILE header can show
// "לקוחות / 571 לקוחות" instead of a bare row of icons. On phones there's no
// sidebar to say where you are, so the bar has to say it.
//
// A context rather than a prop because the top bar lives in the (app) layout and
// persists across navigations — there's no prop path from a page to it, and
// threading one through ~40 AppShell call sites to answer "what page is this"
// would be worse than the problem.

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type PageTitle = { title: string; subtitle?: string; action?: ReactNode } | null;

type Store = {
  pageTitle: PageTitle;
  setPageTitle: (value: PageTitle) => void;
};

const PageTitleContext = createContext<Store>({ pageTitle: null, setPageTitle: () => {} });

export function PageTitleProvider({ children }: { children: ReactNode }) {
  const [pageTitle, setPageTitle] = useState<PageTitle>(null);
  const value = useMemo(() => ({ pageTitle, setPageTitle }), [pageTitle]);
  return <PageTitleContext.Provider value={value}>{children}</PageTitleContext.Provider>;
}

/** Read the current page title — for the top bar. */
export function usePageTitle() {
  return useContext(PageTitleContext).pageTitle;
}

/**
 * Declare this page's title (and optional subtitle, e.g. a live row count).
 * Clears itself on unmount so a page that doesn't set one shows nothing rather
 * than inheriting the previous page's heading.
 */
export function useSetPageTitle(title: string, subtitle?: string, action?: ReactNode) {
  const { setPageTitle } = useContext(PageTitleContext);
  useEffect(() => {
    setPageTitle({ title, subtitle, action });
    return () => setPageTitle(null);
  }, [setPageTitle, title, subtitle, action]);
}

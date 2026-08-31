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

export type PageTitle = {
  /**
   * Usually a string (a route name). A ReactNode when a page needs part of its
   * heading to drop on a narrow bar — the dashboard's greeting keeps the name on
   * a wide bar and shows "ערב טוב 👋" alone on a phone, because the bar's title
   * slot SPILLS rather than shrinking (see TopBar).
   */
  title: ReactNode;
  subtitle?: string;
  action?: ReactNode;
  /**
   * Show this heading in the bar on DESKTOP too. Off by default (user,
   * 2026-08-19): past `lg` the sidebar already says which page you're on, so a
   * title up there repeats it — and the bar is a strip of the page now, not a
   * header that needs a name. The dashboard is the exception, because its
   * heading is a greeting rather than a page name and nothing else says it.
   */
  showOnDesktop?: boolean;
} | null;

type Store = {
  pageTitle: PageTitle;
  setPageTitle: (value: PageTitle) => void;
  headerAction: ReactNode;
  setHeaderAction: (value: ReactNode) => void;
  headerToolbar: ReactNode;
  setHeaderToolbar: (value: ReactNode) => void;
  trailingAction: ReactNode;
  setTrailingAction: (value: ReactNode) => void;
};

const PageTitleContext = createContext<Store>({
  pageTitle: null,
  setPageTitle: () => {},
  headerAction: null,
  setHeaderAction: () => {},
  headerToolbar: null,
  setHeaderToolbar: () => {},
  trailingAction: null,
  setTrailingAction: () => {},
});

export function PageTitleProvider({ children }: { children: ReactNode }) {
  const [pageTitle, setPageTitle] = useState<PageTitle>(null);
  const [headerAction, setHeaderAction] = useState<ReactNode>(null);
  const [headerToolbar, setHeaderToolbar] = useState<ReactNode>(null);
  const [trailingAction, setTrailingAction] = useState<ReactNode>(null);
  const value = useMemo(
    () => ({
      pageTitle, setPageTitle, headerAction, setHeaderAction,
      headerToolbar, setHeaderToolbar, trailingAction, setTrailingAction,
    }),
    [pageTitle, headerAction, headerToolbar, trailingAction]
  );
  return <PageTitleContext.Provider value={value}>{children}</PageTitleContext.Provider>;
}

/** Read the current page title — for the top bar. */
export function usePageTitle() {
  return useContext(PageTitleContext).pageTitle;
}

/** Read the header action — for the top bar. */
export function useHeaderAction() {
  return useContext(PageTitleContext).headerAction;
}

/**
 * Declare a control for the top bar's action slot (right beside the back arrow)
 * WITHOUT owning the title — for pages whose title is set elsewhere, like a
 * detail page whose ⋮ menu is a different component from its tabs.
 * `node` must be referentially stable (wrap it in useMemo).
 */
export function useSetHeaderAction(node: ReactNode) {
  const { setHeaderAction } = useContext(PageTitleContext);
  useEffect(() => {
    // A null node means "I have nothing for the bar" — it must NOT clear a node
    // another instance registered (detail pages mount their actions twice: the
    // desktop row and the phone menu).
    if (node === null || node === undefined) return;
    setHeaderAction(node);
    return () => setHeaderAction(null);
  }, [setHeaderAction, node]);
}

/** Read the header toolbar — for the top bar. */
export function useHeaderToolbar() {
  return useContext(PageTitleContext).headerToolbar;
}

/** Read the trailing action — for the top bar. */
export function useHeaderTrailingAction() {
  return useContext(PageTitleContext).trailingAction;
}

/**
 * Declare a control for the top bar's FAR corner, grouped with the
 * search/notifications/avatar cluster — for a page-level control that
 * belongs at that end of the bar rather than beside the back arrow (see
 * `useSetHeaderAction`, which sits at the other end). חשבונות uses BOTH
 * slots at once: the total stays via `useSetHeaderAction` (near the arrow/
 * sidebar), and "ניהול חשבונות" moves here (user, 2026-08-31: "leave the
 * total there and move the button to be near the icons" — the two controls
 * belong in different slots, not moved together). `node` must be
 * referentially stable (wrap it in useMemo).
 */
export function useSetHeaderTrailingAction(node: ReactNode) {
  const { setTrailingAction } = useContext(PageTitleContext);
  useEffect(() => {
    if (node === null || node === undefined) return;
    setTrailingAction(node);
    return () => setTrailingAction(null);
  }, [setTrailingAction, node]);
}

/**
 * Take over the ENTIRE title slot on a phone with a page's own search/filter
 * row, instead of a page name — for a page whose board wants the vertical
 * space a separate toolbar strip would otherwise cost it (see
 * TasksPageClient.tsx: "move the search and buttons to the top bar so the
 * cards can take the full height"). Unlike `useSetPageTitle`, the node is
 * rendered raw (no whitespace-nowrap/clamp text styling — those assume a
 * heading, not a row of controls). Mobile-only, same as `PageHeaderToolbar`
 * used to be for this content — the desktop layout has its own room for it.
 * `node` must be referentially stable (wrap it in useMemo).
 */
export function useSetHeaderToolbar(node: ReactNode) {
  const { setHeaderToolbar } = useContext(PageTitleContext);
  useEffect(() => {
    if (node === null || node === undefined) return;
    setHeaderToolbar(node);
    return () => setHeaderToolbar(null);
  }, [setHeaderToolbar, node]);
}

/**
 * Declare this page's title (and optional subtitle, e.g. a live row count).
 * Clears itself on unmount so a page that doesn't set one shows nothing rather
 * than inheriting the previous page's heading. Shown in the top bar on PHONES;
 * pass `showOnDesktop` for the rare page whose heading is worth the bar past
 * `lg` too — see TopBar.
 */
export function useSetPageTitle(
  title: ReactNode,
  subtitle?: string,
  action?: ReactNode,
  /** A plain boolean, not an options object — it has to be a stable dep. */
  showOnDesktop?: boolean
) {
  const { setPageTitle } = useContext(PageTitleContext);
  useEffect(() => {
    setPageTitle({ title, subtitle, action, showOnDesktop });
    return () => setPageTitle(null);
  }, [setPageTitle, title, subtitle, action, showOnDesktop]);
}

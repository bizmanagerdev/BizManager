"use client";

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";

type SidebarCollapseValue = {
  collapsed: boolean;
  toggle: () => void;
};

const SidebarCollapseContext = createContext<SidebarCollapseValue>({
  collapsed: false,
  toggle: () => {},
});

// Remembered per browser tab session, so a reload keeps the rail the way the
// user left it but a fresh session starts expanded again.
const STORAGE_KEY = "sidebar-collapsed";
const listeners = new Set<() => void>();
// Fallback when storage is unavailable, so the toggle still works for this page.
let memoryCollapsed = false;

function readCollapsed() {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    return stored === null ? memoryCollapsed : stored === "1";
  } catch {
    return memoryCollapsed;
  }
}

function writeCollapsed(collapsed: boolean) {
  memoryCollapsed = collapsed;
  try {
    sessionStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
  } catch {
    // Storage unavailable (private mode, blocked site data) — state just won't persist.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The rail's collapsed/expanded state, shared by the sidebar and the top bar.
 * The top bar's brand corner must be exactly as wide as the rail underneath it,
 * so the two can't each own a private copy of this flag.
 */
export function SidebarCollapseProvider({ children }: { children: ReactNode }) {
  // Server render (and hydration) always sees the expanded default.
  const collapsed = useSyncExternalStore(subscribe, readCollapsed, () => false);
  const toggle = useCallback(() => writeCollapsed(!readCollapsed()), []);
  const value = useMemo(() => ({ collapsed, toggle }), [collapsed, toggle]);
  return <SidebarCollapseContext.Provider value={value}>{children}</SidebarCollapseContext.Provider>;
}

export function useSidebarCollapse() {
  return useContext(SidebarCollapseContext);
}

/** Rail width, kept in one place so the brand corner and the sidebar agree. */
export const RAIL_WIDTH = { collapsed: "w-14", expanded: "w-40" } as const;

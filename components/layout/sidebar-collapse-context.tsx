"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type SidebarCollapseValue = {
  collapsed: boolean;
  toggle: () => void;
};

const SidebarCollapseContext = createContext<SidebarCollapseValue>({
  collapsed: true,
  toggle: () => {},
});

/**
 * The rail's collapsed/expanded state, shared by the sidebar and the top bar.
 * The top bar's brand corner must be exactly as wide as the rail underneath it,
 * so the two can't each own a private copy of this flag.
 */
export function SidebarCollapseProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(true);
  const toggle = useCallback(() => setCollapsed((value) => !value), []);
  const value = useMemo(() => ({ collapsed, toggle }), [collapsed, toggle]);
  return <SidebarCollapseContext.Provider value={value}>{children}</SidebarCollapseContext.Provider>;
}

export function useSidebarCollapse() {
  return useContext(SidebarCollapseContext);
}

/** Rail width, kept in one place so the brand corner and the sidebar agree. */
export const RAIL_WIDTH = { collapsed: "w-16", expanded: "w-44" } as const;

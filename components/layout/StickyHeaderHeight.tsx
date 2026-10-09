"use client";

import { useEffect } from "react";

/** AppShell's sticky block under the top bar: the alert strip and the page's own search strip. */
export const STICKY_HEADER_ID = "page-sticky-header";

/**
 * Keeps `--page-sticky-h` (on <html>) at that block's live height — 0 with
 * neither an alert nor a search strip, more when an alert wraps or opens — so
 * what sticks under it (the sales tab bar) sits right below it, instead of at
 * a fixed guess that an alert strip pushed out of line (owner, 2026-10-09: the
 * scrolled tab bar slid under the search strip).
 */
export default function StickyHeaderHeight() {
  useEffect(() => {
    const block = document.getElementById(STICKY_HEADER_ID);
    if (!block) return;
    const root = document.documentElement;
    const apply = () => root.style.setProperty("--page-sticky-h", `${Math.round(block.getBoundingClientRect().height)}px`);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(block);
    return () => observer.disconnect();
  }, []);
  return null;
}

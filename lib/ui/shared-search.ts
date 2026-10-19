"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

// One search box shared by a section's tabs (owner, 2026-10-19: "the search
// bar in open orders and closed orders should be shared — if I type in one
// tab it should last in the other tab, and on mobile it should last the tab
// switch; same for projects").
//
// The text lives here, in memory, under a key (one per list, e.g. "orders"),
// so a tab that opens finds what was typed in the one before it — on the
// desktop box and the phone's top-bar box alike. It stays while you're in the
// section (an order's page and back keeps it) and is dropped once you leave
// it, so a search from earlier never silently narrows the list later on.

const values = new Map<string, string>();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The shared text for `key` (or undefined when nothing was typed yet). */
export function readSharedSearch(key: string): string | undefined {
  return values.get(key);
}

export function writeSharedSearch(key: string, value: string) {
  if (values.get(key) === value) return;
  values.set(key, value);
  emit();
}

export function clearSharedSearch(key: string) {
  if (!values.has(key)) return;
  values.delete(key);
  emit();
}

/**
 * [text, setText] for a list's search box, shared by every tab using `key`.
 * `initial` (a `q` in the address) wins when nothing was typed yet. When the
 * list closes and the address no longer starts with `sectionPath`, the text is
 * dropped.
 */
export function useSharedSearch(key: string, initial: string, sectionPath: string) {
  const value = useSyncExternalStore(
    subscribe,
    () => values.get(key) ?? initial,
    () => initial
  );
  const setValue = useCallback((next: string) => writeSharedSearch(key, next), [key]);

  useEffect(() => {
    return () => {
      // Let the next page's address settle first; a tab of the same section
      // keeps the text, anywhere else drops it.
      window.setTimeout(() => {
        if (!window.location.pathname.startsWith(sectionPath)) clearSharedSearch(key);
      }, 1000);
    };
  }, [key, sectionPath]);

  return [value, setValue] as const;
}

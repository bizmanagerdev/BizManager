"use client";

import { useEffect } from "react";
import { useSetPageTitle } from "@/components/layout/page-title-context";

// The phone's top bar says "לקוחות" with the count under it. The count used to
// arrive with the list, and the title moved up 7px to make room for it
// (measured, 2026-10-13). The loading screen now holds that line from its
// first frame: the last count this session saw, or a blank line of the same
// height until there is one — so the count fills it in without moving anything.

const TITLE = "לקוחות";
// A no-break space: an "empty" subtitle that still takes its line.
const RESERVED_LINE = String.fromCharCode(0xa0);

let lastKnownCount: number | null = null;

/** "655 לקוחות" — the subtitle the list sets (and the loading screen remembers). */
export function customersSubtitle(count: number) {
  return `${count} לקוחות`;
}

/** The list's own title: remembers its count for the next loading screen. */
export function useCustomersTitle(count: number) {
  useEffect(() => {
    lastKnownCount = count;
  }, [count]);
  useSetPageTitle(TITLE, customersSubtitle(count));
}

/** The title while the list isn't on screen yet (or couldn't load). Renders nothing. */
export default function CustomersTitle() {
  useSetPageTitle(TITLE, lastKnownCount === null ? RESERVED_LINE : customersSubtitle(lastKnownCount));
  return null;
}

"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

// Deep-link focus: any page can be opened at ONE specific row with `?focus=<id>`
// (see buildFocusHref in lib/audit.ts). This component — mounted once in the app
// shell — finds the element carrying `data-focus-id="<id>"`, scrolls it into
// view and flashes it. Pages opt in by putting that attribute on their list rows;
// nothing else is required, and a page that hasn't opted in simply ignores the
// param instead of breaking.
export const FOCUS_PARAM = "focus";

const FLASH_CLASS = "focus-flash";
// Lists arrive after hydration (and some fetch their own data), so keep looking
// for the row for a few seconds instead of giving up on the first paint.
const LOOKUP_TIMEOUT_MS = 8000;
const RETRY_MS = 150;
const FLASH_MS = 4000;

export default function FocusHighlighter() {
  const searchParams = useSearchParams();
  const focusId = searchParams.get(FOCUS_PARAM);

  useEffect(() => {
    if (!focusId) return;

    let cancelled = false;
    let target: HTMLElement | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let flashTimer: ReturnType<typeof setTimeout> | null = null;
    const deadline = Date.now() + LOOKUP_TIMEOUT_MS;
    const selector = `[data-focus-id="${CSS.escape(focusId)}"]`;

    // Most lists render twice — a desktop table and a mobile card list, both
    // carrying the same id — so take the one that is actually on screen rather
    // than whichever comes first in the DOM.
    const findVisible = (): HTMLElement | null => {
      const matches = Array.from(document.querySelectorAll(selector));
      for (const el of matches) {
        if (el instanceof HTMLElement && el.getClientRects().length > 0) return el;
      }
      return null;
    };

    const attempt = () => {
      if (cancelled) return;
      const found = findVisible();
      if (found) {
        target = found;
        // Class first: it carries the scroll-margin that keeps the row clear of
        // the sticky top bar.
        found.classList.add(FLASH_CLASS);
        found.scrollIntoView({ behavior: "smooth", block: "center" });
        flashTimer = setTimeout(() => found.classList.remove(FLASH_CLASS), FLASH_MS);
        return;
      }
      if (Date.now() < deadline) retryTimer = setTimeout(attempt, RETRY_MS);
    };

    attempt();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (flashTimer) clearTimeout(flashTimer);
      target?.classList.remove(FLASH_CLASS);
    };
  }, [focusId]);

  return null;
}

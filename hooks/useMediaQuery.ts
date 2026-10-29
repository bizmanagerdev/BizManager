"use client";

import { useSyncExternalStore } from "react";

/** Whether a CSS media query matches now, following it as it changes. False on the server. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Tailwind's `md` — where the side menu shows and the phone's bottom menu goes. */
export const DESKTOP_MENU_QUERY = "(min-width: 48rem)";

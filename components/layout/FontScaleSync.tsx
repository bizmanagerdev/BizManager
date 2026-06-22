"use client";

import { useEffect } from "react";

// Reconciles the per-account text-size multiplier across devices.
//
// CLS-critical: the entire UI is rem-based on --font-scale, so changing that
// custom property AFTER first paint reflows the whole document — a large,
// whole-page layout shift (it shows up in Web Vitals attributed to <html> /
// body::before). So this NO LONGER mutates the DOM. The pre-paint script in
// app/layout.tsx applies the cached value with no FOUC; here we only persist the
// account value to localStorage so the NEXT load's pre-paint script picks it up.
// Trade-off: a cross-device scale change takes effect on the next reload instead
// of shifting the page the user is currently looking at. (Same-device changes
// from the profile page still apply instantly there.)
export default function FontScaleSync() {
  useEffect(() => {
    try {
      if (sessionStorage.getItem("biz-font-scale-synced") === "1") return;
    } catch {
      // sessionStorage unavailable (e.g. private mode) — just proceed.
    }

    let active = true;
    void fetch("/api/profile/font-scale", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((json: { fontScale?: number | null } | null) => {
        if (!active) return;
        try { sessionStorage.setItem("biz-font-scale-synced", "1"); } catch { /* ignore */ }
        const scale = Number(json?.fontScale);
        if (!Number.isFinite(scale) || scale <= 0) return; // unset → keep local
        // Persist only — applied pre-paint on the next load, so no reflow now.
        try {
          if (localStorage.getItem("biz-font-scale") !== String(scale)) {
            localStorage.setItem("biz-font-scale", String(scale));
          }
        } catch { /* ignore */ }
      })
      .catch(() => {
        // Offline / network error — the locally-cached value stays in effect.
      });

    return () => {
      active = false;
    };
  }, []);

  return null;
}

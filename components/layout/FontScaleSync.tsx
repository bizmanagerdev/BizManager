"use client";

import { useEffect } from "react";

// Reconciles the per-account text-size multiplier across devices. The pre-paint
// script in app/layout.tsx already applied the locally-cached value with no
// FOUC; here we fetch the account value once per browser session and apply it
// if the user has explicitly chosen one (the endpoint returns null when unset,
// so a device-local preference is preserved until they pick one).
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
        // Clear any stale absolute inline font-size from older builds.
        document.documentElement.style.removeProperty("font-size");
        document.documentElement.style.setProperty("--font-scale", String(scale));
        try { localStorage.setItem("biz-font-scale", String(scale)); } catch { /* ignore */ }
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

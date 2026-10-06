"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** A frame rendered this long before the app opened came from a saved copy. */
const FRAME_FRESH_MS = 15_000;
/** At most one refresh per page this often — never a reload loop on a bad connection. */
const REFRESH_AT_MOST_EVERY_MS = 60_000;

/**
 * Marks a page drawn from the device copy, so the service worker saves its
 * frame and shows it at once the next time the app opens (public/sw.js,
 * FRAMES_CACHE). When the app opened on such a saved frame — rendered well
 * before this page load began — the page's server parts (the top bar, the
 * dashboard's money cards) are refreshed quietly; the device-drawn parts are
 * current anyway. Moving between pages inside the app never triggers it (a
 * page loaded ahead is rendered after the app opened), and neither does
 * being offline.
 */
export default function DeviceFrameMark({ page, renderedAt }: { page: string; renderedAt: number }) {
  const router = useRouter();
  useEffect(() => {
    if (renderedAt >= performance.timeOrigin - FRAME_FRESH_MS) return;
    if (!navigator.onLine) return;
    const key = `bizh-frame-refreshed:${page}`;
    try {
      const last = Number(sessionStorage.getItem(key) ?? "0");
      if (Date.now() - last < REFRESH_AT_MOST_EVERY_MS) return;
      sessionStorage.setItem(key, String(Date.now()));
    } catch {
      // No session storage: refresh anyway (once per page load).
    }
    router.refresh();
  }, [page, renderedAt, router]);
  return <span hidden data-device-page={page} />;
}

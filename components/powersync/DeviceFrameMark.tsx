"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** A frame older than this was shown from a saved copy: its server parts are refreshed. */
const FRAME_FRESH_MS = 15_000;

/**
 * Marks a page drawn from the device copy, so the service worker saves its
 * frame and shows it at once the next time the app opens (public/sw.js,
 * FRAMES_CACHE). Shown from such a saved frame — or any copy older than a few
 * seconds — the page's server parts (the top bar, the dashboard's money
 * cards) are refreshed quietly; the device-drawn parts are current anyway.
 */
export default function DeviceFrameMark({ page, renderedAt }: { page: string; renderedAt: number }) {
  const router = useRouter();
  useEffect(() => {
    if (Date.now() - renderedAt > FRAME_FRESH_MS) router.refresh();
  }, [renderedAt, router]);
  return <span hidden data-device-page={page} />;
}

"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import type { PreviewSlot } from "@/lib/ui/preview-slot";

/**
 * For a page's loading screen: the preview its list left for `id` (see
 * createPreviewSlot), or null — then the screen shows its plain skeleton.
 *
 * Read once: the slot is cleared when the screen goes away, and a re-render
 * in between must not swap the header for grey bars. With a preview, the page
 * starts at its top: opened from a list scrolled down, Next's own
 * scroll-to-top doesn't always fire (it can pick a <script> tag the route
 * brings along as "the page" and give up), and the header would sit above the
 * screen while the user looks at grey blocks.
 */
export function useRoutePreview<T extends { id: string }>(slot: PreviewSlot<T>, id: string): T | null {
  const [preview] = useState(() => slot.read(id));

  useLayoutEffect(() => {
    if (preview) window.scrollTo(0, 0);
  }, [preview]);

  useEffect(() => () => slot.forget(id), [slot, id]);

  return preview;
}

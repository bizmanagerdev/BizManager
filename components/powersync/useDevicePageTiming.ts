"use client";

import { useLayoutEffect, useRef } from "react";
import { reportPageTiming, type TimingSource } from "@/lib/powersync/page-timing";

/**
 * Times a device-drawn page part once per mount: from the tap that opened the
 * page to its content painted (lib/powersync/page-timing.ts).
 */
export function useDevicePageTiming(
  page: string,
  shown: { source: TimingSource | "previous"; computeMs?: number } | null,
  size?: number
): void {
  const done = useRef(false);
  const details = useRef({ computeMs: shown?.computeMs, size });
  useLayoutEffect(() => {
    details.current = { computeMs: shown?.computeMs, size };
  });
  const source = shown && shown.source !== "previous" ? shown.source : null;
  useLayoutEffect(() => {
    if (!source || done.current) return;
    done.current = true;
    const committedAt = performance.now();
    const { computeMs, size: count } = details.current;
    // Two frames: the first runs before the browser paints, the second after.
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        reportPageTiming({ page, source, committedAt, paintedAt: performance.now(), computeMs, size: count })
      )
    );
  }, [source, page]);
}

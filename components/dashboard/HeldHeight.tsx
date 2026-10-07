"use client";

import { useEffect, useRef } from "react";
import { rememberHeldHeight } from "@/lib/ui/held-heights";

/** How long a card's height must hold still before it's kept. */
const SETTLE_MS = 800;

/**
 * Sits inside a dashboard card's cell (renders nothing) and keeps the cell's
 * height on this device once its real content is in — no loading placeholder
 * inside — and has settled (lib/ui/held-heights.ts). The next time the board
 * loads, that card's placeholder is exactly that tall.
 */
export default function HeldHeight({ id }: { id: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const cell = ref.current?.parentElement;
    if (!cell || typeof ResizeObserver === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const keep = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        // Still loading (a placeholder), or the card decided it has nothing to show.
        if (cell.querySelector(".animate-pulse") || cell.offsetHeight === 0) return;
        rememberHeldHeight(id, cell.offsetHeight);
      }, SETTLE_MS);
    };
    const observer = new ResizeObserver(keep);
    observer.observe(cell);
    keep();
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [id]);
  return <span ref={ref} hidden data-held-marker="" />;
}

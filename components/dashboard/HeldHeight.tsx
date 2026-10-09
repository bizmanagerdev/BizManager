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
        // The board's cards as they stand, in its running order (each cell's
        // `order`), so the board's loading placeholder can draw them in it.
        // A card with nothing to show (a hidden cell) is left out.
        const board = Array.from(document.querySelectorAll<HTMLElement>("[data-board-cell]"))
          .filter((c) => c.offsetHeight > 0)
          .sort((a, b) => Number(a.style.order) - Number(b.style.order))
          .map((c) => c.querySelector<HTMLElement>(":scope > [data-held-marker]")?.dataset.heldId ?? "")
          .filter(Boolean);
        rememberHeldHeight(id, cell.offsetHeight, board);
      }, SETTLE_MS);
    };
    const observer = new ResizeObserver(keep);
    observer.observe(cell);
    // Also when the card replaces its placeholder at the same height (no
    // resize) — the board's order still has to be kept.
    const swapped = new MutationObserver(keep);
    swapped.observe(cell, { childList: true });
    keep();
    return () => {
      observer.disconnect();
      swapped.disconnect();
      clearTimeout(timer);
    };
  }, [id]);
  return <span ref={ref} hidden data-held-marker="" data-held-id={id} />;
}

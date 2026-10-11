"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// The phone bar's page name and record name, always whole (owner, 2026-10-11:
// the header must never be cut off with "…"). The bar is a fixed 60px rail
// between the back arrow / ⋮ and the search / inbox / avatar icons, so instead
// of cutting, each line steps down a little until it fits: with the bar's
// spacing tightened, every customer and project name in use fits a 360px
// phone this way (measured 2026-10-11; today's 2-line clamp cut 18% of them).

/** The record name under the page name: 2 lines at 12px, then 3 at 11, then 3 at 10. */
const SUBTITLE_STEPS = [
  { px: 12, lines: 2, leading: 1.25 },
  { px: 11, lines: 3, leading: 1.2 },
  { px: 10, lines: 3, leading: 1.2 },
] as const;

/** The page name: one line, from the bar's own size down to 11px before it would be cut. */
const TITLE_MIN_PX = 11;

/** Re-run `fit` whenever the element's width changes (the phone turning, the slot settling). */
function useFitOnWidth(ref: React.RefObject<HTMLElement | null>, fit: (el: HTMLElement) => void, deps: unknown[]) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    fit(el);
    if (typeof ResizeObserver === "undefined") return;
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      fit(el);
    });
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

function fitSubtitle(el: HTMLElement) {
  for (const step of SUBTITLE_STEPS) {
    el.style.fontSize = `${step.px}px`;
    el.style.lineHeight = String(step.leading);
    el.style.setProperty("-webkit-line-clamp", String(step.lines));
    // scrollHeight is the whole text's height even while clamped.
    if (el.scrollHeight <= Math.ceil(step.px * step.leading * step.lines) + 1) return;
  }
}

function fitTitle(el: HTMLElement) {
  el.style.fontSize = "";
  const max = parseFloat(getComputedStyle(el).fontSize);
  for (let px = max; px >= TITLE_MIN_PX; px -= 0.5) {
    el.style.fontSize = `${px}px`;
    if (el.scrollWidth <= el.clientWidth + 1) return;
  }
}

export function BarTitle({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useFitOnWidth(ref, fitTitle, [children]);
  return (
    <span ref={ref} className={className}>
      {children}
    </span>
  );
}

export function BarSubtitle({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useFitOnWidth(ref, fitSubtitle, [text]);
  return (
    <span ref={ref} data-bar-subtitle="" className={cn("line-clamp-2 text-[12px] leading-tight", className)}>
      {text}
    </span>
  );
}

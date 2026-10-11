"use client";

import { useEffect, useRef, useState } from "react";

// Pull down to refresh, like every other app (owner, 2026-10-11). Only inside the
// Android app: a phone browser (Chrome) already does this itself, and the app's
// web view doesn't.
//
// Starts only when the page is at its very top, nothing is open on top of it
// (a dialog, a sheet, a menu), and the finger isn't in a list that scrolls on its
// own and is scrolled down. A mostly-sideways move is left alone (swiping between
// tabs, the tasks board). Pulling past the line and letting go reloads the page;
// letting go before it springs back. The indicator moves with transform only, so
// nothing on the page shifts.
//
// The indicator is the logo going up (owner, 2026-10-11: "I want to see our icon
// going up … a visual showing that it's working"): as you pull, its three
// chevrons light up from the bottom one to the top one; at the line it pops
// (and the phone ticks); while the page reloads they keep climbing.

const THRESHOLD = 72; // px of pull (after resistance) that triggers a refresh
const MAX_PULL = 110;
const RESISTANCE = 0.5;
const DIM = 0.22; // an unlit chevron

// The mark's three chevrons (components/ui/brand-mark.tsx), bottom one first:
// the order they light up in.
const CHEVRONS = [
  "M 0.00 67.90 L 12.29 75.62 L 49.85 52.04 L 87.39 75.61 L 100.00 67.70 L 100.00 83.06 L 87.49 90.92 L 75.25 83.23 L 49.96 67.33 L 12.40 90.92 L 0.16 83.23 L 0.00 83.13 Z",
  "M 0.00 41.88 L 12.29 49.60 L 49.85 26.02 L 87.39 49.59 L 100.00 41.68 L 100.00 57.04 L 87.49 64.90 L 75.25 57.22 L 49.96 41.32 L 12.40 64.90 L 0.16 57.22 L 0.00 57.11 Z",
  "M 99.54 31.20 L 87.41 38.81 L 49.96 15.30 L 12.40 38.88 L 0.16 31.20 L 49.85 0.00 Z",
];

const OPEN_LAYER =
  '[role="dialog"][data-state="open"],[role="alertdialog"][data-state="open"],[role="menu"][data-state="open"],[role="listbox"][data-state="open"],[data-radix-popper-content-wrapper]';

function insideScrolledList(node: EventTarget | null): boolean {
  let el = node instanceof Element ? node : null;
  while (el && el !== document.body && el !== document.documentElement) {
    if (el instanceof HTMLElement && el.scrollTop > 0) {
      const overflowY = getComputedStyle(el).overflowY;
      if (overflowY === "auto" || overflowY === "scroll") return true;
    }
    el = el.parentElement;
  }
  return false;
}

export default function PullToRefresh() {
  const [enabled, setEnabled] = useState(false);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const markRef = useRef<SVGSVGElement>(null);
  const chevronRefs = useRef<(SVGPathElement | null)[]>([]);

  useEffect(() => {
    let cancelled = false;
    void import("@capacitor/core")
      .then(({ Capacitor }) => {
        if (!cancelled && Capacitor.isNativePlatform()) setEnabled(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const indicator = indicatorRef.current;
    const mark = markRef.current;
    const chevrons = chevronRefs.current.filter((path): path is SVGPathElement => path !== null);
    if (!indicator || !mark || chevrons.length !== CHEVRONS.length) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let startX = 0;
    let startY = 0;
    let pull = 0;
    let tracking = false; // a touch that may become a pull
    let pulling = false; // decided: this touch is a pull
    let ready = false; // past the line: letting go refreshes
    let refreshing = false;

    const show = (distance: number, animate: boolean) => {
      indicator.style.transition = animate ? "transform 200ms ease, opacity 200ms ease" : "none";
      indicator.style.transform = `translate3d(-50%, ${distance - 56}px, 0)`;
      indicator.style.opacity = distance > 4 ? "1" : "0";

      // Light the chevrons from the bottom up as the pull grows.
      const progress = Math.min(distance / THRESHOLD, 1);
      chevrons.forEach((chevron, i) => {
        const lit = Math.min(Math.max((progress - i / CHEVRONS.length) * CHEVRONS.length, 0), 1);
        chevron.style.opacity = String(DIM + (1 - DIM) * lit);
      });

      const nowReady = progress >= 1;
      if (nowReady && !ready && !animate) navigator.vibrate?.(10);
      ready = nowReady;
      mark.style.transform = nowReady ? "scale(1.18)" : "scale(1)";
    };

    const reset = () => {
      tracking = false;
      pulling = false;
      pull = 0;
      show(0, true);
    };

    const onStart = (event: TouchEvent) => {
      if (refreshing || event.touches.length !== 1) return;
      if (window.scrollY > 0 || document.querySelector(OPEN_LAYER) || insideScrolledList(event.target)) return;
      tracking = true;
      pulling = false;
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
    };

    const onMove = (event: TouchEvent) => {
      if (!tracking || event.touches.length !== 1) return;
      const dx = event.touches[0].clientX - startX;
      const dy = event.touches[0].clientY - startY;
      if (!pulling) {
        if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
          tracking = false; // sideways: not ours
          return;
        }
        if (dy < 8) {
          if (dy < -4) tracking = false; // scrolling down the page
          return;
        }
        if (window.scrollY > 0) {
          tracking = false;
          return;
        }
        pulling = true;
      }
      pull = Math.min(MAX_PULL, (dy - 8) * RESISTANCE);
      if (event.cancelable) event.preventDefault(); // no web view overscroll glow while pulling
      show(pull, false);
    };

    // Working: the chevrons keep climbing, bottom to top, until the new page is in.
    const climb = () => {
      if (reducedMotion) {
        chevrons.forEach((chevron) => (chevron.style.opacity = "1"));
        return;
      }
      chevrons.forEach((chevron, i) => {
        chevron.animate(
          [{ opacity: DIM }, { opacity: 1, offset: 0.3 }, { opacity: 1, offset: 0.55 }, { opacity: DIM }],
          { duration: 900, delay: i * 150, iterations: Infinity, easing: "ease-in-out" }
        );
      });
      mark.animate([{ transform: "translateY(3px) scale(1.18)" }, { transform: "translateY(-3px) scale(1.18)" }], {
        duration: 900,
        iterations: Infinity,
        easing: "ease-out",
      });
    };

    const onEnd = () => {
      if (!tracking) return;
      if (pulling && pull >= THRESHOLD) {
        refreshing = true;
        tracking = false;
        show(THRESHOLD, true);
        climb();
        // Long enough for the climb to be seen; the old page stays on screen
        // (still climbing) until the new one is drawn.
        window.setTimeout(() => window.location.reload(), 300);
        return;
      }
      reset();
    };

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd, { passive: true });
    document.addEventListener("touchcancel", reset, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", reset);
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div
      ref={indicatorRef}
      aria-hidden="true"
      className="pointer-events-none fixed left-1/2 top-[env(safe-area-inset-top)] z-[100] flex size-11 items-center justify-center rounded-full bg-white text-secondary shadow-elevated"
      style={{ transform: "translate3d(-50%, -56px, 0)", opacity: 0 }}
    >
      <svg
        ref={markRef}
        viewBox="0 0 100 90.92"
        fill="currentColor"
        className="h-5 w-auto transition-transform duration-150"
      >
        {CHEVRONS.map((d, i) => (
          <path
            key={d}
            d={d}
            opacity={DIM}
            ref={(path) => {
              chevronRefs.current[i] = path;
            }}
          />
        ))}
      </svg>
    </div>
  );
}

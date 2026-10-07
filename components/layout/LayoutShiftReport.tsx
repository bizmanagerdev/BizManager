"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { withSentry } from "@/lib/sentry-lazy";
import { installNavigationTiming, lastNavigationStart } from "@/lib/ui/navigation-timing";

// What jumps on screen, and by how much — the "messy" loading the owner sees
// on phones (Speed Insights: layout shift ~0.78 on the phone dashboard,
// projects, tasks and a project's page; ~0.03 on desktop). For each page
// opened, the shifts in its first seconds that the person didn't cause
// (taps, typing) are added up, and when they're noticeable the biggest ones
// go to Sentry ("Layout shift") with what moved: which element, how far down,
// how much it grew. At most REPORTS_PER_DAY a day per page per device.

/** How long after a page opens its shifts count as its loading. */
const WINDOW_MS = 8000;
/** Below this total the page loaded calmly (Google's "good" is 0.1). */
const REPORT_ABOVE = 0.05;
const REPORTS_PER_DAY = 5;

type Shift = { at: number; value: number; sources: { el: string; dy: number; dh: number }[] };

type LayoutShiftEntry = PerformanceEntry & {
  value: number;
  hadRecentInput: boolean;
  sources?: Array<{ node: Node | null; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }>;
};

const shifts: Shift[] = [];

/** A short, readable name for an element: tag, id, a few classes and data-* names, its text's start. */
function describe(node: Node | null): string {
  if (!node) return "(removed)";
  if (!(node instanceof Element)) return node.nodeName.toLowerCase();
  const id = node.id ? `#${node.id}` : "";
  const classes = Array.from(node.classList)
    .slice(0, 4)
    .map((c) => `.${c}`)
    .join("");
  const data = Array.from(node.attributes)
    .filter((a) => a.name.startsWith("data-"))
    .slice(0, 3)
    .map((a) => `[${a.name}]`)
    .join("");
  const text = (node.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 24);
  return `${node.tagName.toLowerCase()}${id}${classes}${data}${text ? ` "${text}"` : ""}`;
}

/** /projects/3f2a…/export → /projects/[id]/export */
function pageKey(pathname: string): string {
  return pathname.replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "/[id]");
}

function underDailyLimit(page: string): boolean {
  try {
    const key = `bizh-shifts:${new Date().toISOString().slice(0, 10)}:${page}`;
    const count = Number(localStorage.getItem(key) ?? "0");
    if (count >= REPORTS_PER_DAY) return false;
    localStorage.setItem(key, String(count + 1));
    return true;
  } catch {
    return false;
  }
}

let observing = false;

function observe() {
  if (observing || typeof PerformanceObserver === "undefined") return;
  if (!PerformanceObserver.supportedEntryTypes?.includes("layout-shift")) return;
  observing = true;
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries() as LayoutShiftEntry[]) {
      if (entry.hadRecentInput) continue;
      shifts.push({
        at: entry.startTime,
        value: entry.value,
        sources: (entry.sources ?? []).slice(0, 3).map((s) => ({
          el: describe(s.node),
          dy: Math.round(s.currentRect.y - s.previousRect.y),
          dh: Math.round(s.currentRect.height - s.previousRect.height),
        })),
      });
      if (shifts.length > 200) shifts.splice(0, shifts.length - 200);
    }
  }).observe({ type: "layout-shift", buffered: true });
}

export default function LayoutShiftReport() {
  const pathname = usePathname();
  useEffect(() => {
    installNavigationTiming();
    observe();
  }, []);

  useEffect(() => {
    if (!pathname) return;
    const start = lastNavigationStart();
    const page = pageKey(pathname);
    const timer = setTimeout(() => {
      const mine = shifts.filter((s) => s.at >= start && s.at < start + WINDOW_MS);
      const total = mine.reduce((sum, s) => sum + s.value, 0);
      if (total < REPORT_ABOVE || !underDailyLimit(page)) return;
      const biggest = [...mine].sort((a, b) => b.value - a.value).slice(0, 5);
      const width = window.innerWidth;
      withSentry((Sentry) =>
        Sentry.captureMessage("Layout shift", {
          level: "info",
          tags: {
            area: "layout",
            shift_page: page,
            shift_screen: width < 768 ? "phone" : width < 1280 ? "tablet" : "desktop",
            shift_load: start === 0 ? "full" : "navigation",
          },
          extra: {
            total: Math.round(total * 1000) / 1000,
            count: mine.length,
            width,
            shifts: biggest.map((s) => ({ ...s, at: Math.round(s.at - start), value: Math.round(s.value * 1000) / 1000 })),
          },
        })
      );
    }, WINDOW_MS);
    return () => clearTimeout(timer);
  }, [pathname]);

  return null;
}

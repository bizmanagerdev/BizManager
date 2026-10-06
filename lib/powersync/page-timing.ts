import { withSentry } from "@/lib/sentry-lazy";
import { lastNavigationStart } from "@/lib/ui/navigation-timing";

// How long a page drawn from the device copy took to show, and where the
// time went — reported to Sentry ("PowerSync page timing"), at most a few
// times a day per device and page so it stays cheap. What it tells apart:
//   serverMs — waiting for the server's answer for the page (0 = the app
//              already had it);
//   afterServerMs — from that answer to the page's content on screen: the
//              app's code loading, the device's work, drawing;
//   computeMs — of that, the device working the content out (when it did);
//   paintMs  — from the content being ready to it being painted.

export type TimingSource = "device" | "kept" | "stored";

const REPORTS_PER_DAY = 3;

function underDailyLimit(page: string): boolean {
  try {
    const key = `bizh-timing:${new Date().toISOString().slice(0, 10)}:${page}`;
    const count = Number(localStorage.getItem(key) ?? "0");
    if (count >= REPORTS_PER_DAY) return false;
    localStorage.setItem(key, String(count + 1));
    return true;
  } catch {
    return false;
  }
}

/** When the server's answer for this page change arrived (relative to performance.now()), if it can be told. */
function serverAnswerAt(navStart: number): number | null {
  if (navStart === 0) {
    const entry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    return entry ? entry.responseEnd : null;
  }
  const answers = (performance.getEntriesByType("resource") as PerformanceResourceTiming[]).filter(
    (e) => e.name.includes("_rsc=") && e.startTime >= navStart - 50 && new URL(e.name).pathname === window.location.pathname
  );
  return answers.length ? answers[answers.length - 1].responseEnd : null;
}

export function reportPageTiming({
  page,
  source,
  committedAt,
  paintedAt,
  computeMs,
  size,
}: {
  page: string;
  source: TimingSource;
  committedAt: number;
  paintedAt: number;
  computeMs?: number;
  size?: number;
}): void {
  if (!underDailyLimit(page)) return;
  const navStart = lastNavigationStart();
  const answerAt = serverAnswerAt(navStart);
  const round = (n: number) => Math.round(n);
  const extra = {
    totalMs: round(paintedAt - navStart),
    serverMs: answerAt === null ? null : round(Math.max(0, answerAt - navStart)),
    afterServerMs: answerAt === null ? null : round(committedAt - Math.max(answerAt, navStart)),
    computeMs: computeMs === undefined ? null : round(computeMs),
    paintMs: round(paintedAt - committedAt),
    size: size ?? null,
  };
  withSentry((Sentry) =>
    Sentry.captureMessage("PowerSync page timing", {
      level: "info",
      tags: { area: "powersync", timing_page: page, timing_source: source, timing_load: navStart === 0 ? "full" : "navigation" },
      extra,
    })
  );
}

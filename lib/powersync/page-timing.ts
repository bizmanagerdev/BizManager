import { withSentry } from "@/lib/sentry-lazy";
import { lastNavigationStart } from "@/lib/ui/navigation-timing";

// How long a page drawn from the device copy took to show, and where the
// time went — reported to Sentry ("PowerSync page timing"), at most
// REPORTS_PER_DAY times a day per device and page so it stays cheap. What it
// tells apart:
//   serverMs — waiting for the server's answer for the page (0 = the app
//              already had it);
//   afterServerMs — from that answer to the page's content on screen: the
//              app's code loading, the device's work, drawing;
//   computeMs — of that, the device working the content out (when it did);
//   paintMs  — from the content being ready to it being painted.

export type TimingSource = "device" | "kept" | "stored";

type TimingLoad = "full" | "navigation";

/**
 * Reports a day per device and page — app openings (a full load) and moves
 * inside the app counted apart, so trying the opening again and again doesn't
 * use up the moves' reports, or the other way round.
 */
const REPORTS_PER_DAY: Record<TimingLoad, number> = { full: 30, navigation: 10 };
/**
 * A page part drawn this long after the last tap wasn't opened by it — it was
 * drawn again later (after a save, a refresh): not a page opening.
 */
const OPENING_WINDOW_MS = 30_000;
/** The page change each page part was last reported for: drawn again for the same one, it isn't reported twice. */
const reportedFor = new Map<string, number>();

function dailyKey(page: string, load: TimingLoad): string {
  return `bizh-timing:${new Date().toISOString().slice(0, 10)}:${page}:${load}`;
}

function underDailyLimit(page: string, load: TimingLoad): boolean {
  try {
    return Number(localStorage.getItem(dailyKey(page, load)) ?? "0") < REPORTS_PER_DAY[load];
  } catch {
    return false;
  }
}

/** Counted when it's actually sent — a page that reloads before then doesn't use up the day's reports. */
function countReport(page: string, load: TimingLoad) {
  try {
    const key = dailyKey(page, load);
    localStorage.setItem(key, String(Number(localStorage.getItem(key) ?? "0") + 1));
  } catch {
    // Storage blocked: no limit to keep.
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
  const navStart = lastNavigationStart();
  const load: TimingLoad = navStart === 0 ? "full" : "navigation";
  if (!underDailyLimit(page, load)) return;
  if (committedAt - navStart > OPENING_WINDOW_MS || reportedFor.get(page) === navStart) return;
  reportedFor.set(page, navStart);
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
  withSentry((Sentry) => {
    if (!underDailyLimit(page, load)) return;
    countReport(page, load);
    Sentry.captureMessage("PowerSync page timing", {
      level: "info",
      tags: { area: "powersync", timing_page: page, timing_source: source, timing_load: load },
      extra,
    });
  });
}

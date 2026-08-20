"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { ChevronDownIcon, ClockIcon } from "@/components/ui/icons";
import { Card, CardContent } from "@/components/ui/card";
import DashboardCardHeader from "@/components/dashboard/DashboardCardHeader";
import DashboardCardFooter from "@/components/dashboard/DashboardCardFooter";
import Sparkline from "@/components/charts/Sparkline";
import QuietCard from "@/components/dashboard/QuietCard";
import { InitialsAvatar } from "@/components/dashboard/InitialsAvatar";
import PendingReportCard from "@/components/attendance/PendingReportCard";
import { formatMinutes, minutesBetween } from "@/lib/payroll";
import { cn } from "@/lib/utils";
import { formatShortDate, hebrewWeekday } from "@/lib/date";
import type { PendingPhoneReport, PhoneQueueData } from "@/lib/attendance/phone-reports";
import type { SalaryCenterProjectOption } from "@/lib/payroll-center";
import { t } from "@/lib/i18n/t";
import { dashboardDict } from "@/lib/i18n/dictionaries/dashboard";
import type { Locale } from "@/lib/i18n/types";

/** The shift's DAY in Israel time — the grouping key, sortable as a string. */
function dayKey(iso: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/** "יום שני 10/08/26" — the heading over one day's reports. */
function dayLabel(iso: string) {
  return `${hebrewWeekday(iso)} ${formatShortDate(iso)}`;
}

/** One entry per day, in the order the reports already came in (newest first). */
function groupByDay(reports: PendingPhoneReport[]): Array<[string, PendingPhoneReport[]]> {
  const byDay = new Map<string, PendingPhoneReport[]>();
  for (const report of reports) {
    const key = dayKey(report.clock_in);
    const bucket = byDay.get(key);
    if (bucket) bucket.push(report);
    else byDay.set(key, [report]);
  }
  return [...byDay.entries()];
}

/** Where the card leads: the payroll attendance-queue page. */
const QUEUE_HREF = "/payroll/attendance";

/** How many waiting reports the dashboard shows before deferring to the page. */
const SHOWN_LIMIT = 4;

/**
 * "נוכחות עובדים" — the head of the attendance queue, ACTIONABLE in place: each
 * waiting report is the same approve / reject / split card the queue page uses
 * (PendingReportCard), so a shift gets classified and approved without leaving
 * the dashboard.
 *
 * Deliberately no summary tiles, no "דיווח נוכחות" button and no link button
 * (user, 2026-08-17): the numbers only restated the list under them, the + lives
 * in the top bar's quick-create menu, and the card itself is the link — click
 * anywhere outside a report row and you land on the queue page.
 *
 * Cost stays off: the dashboard calls loadPhoneQueueData without `includeCost`,
 * so labor_cost is null and the report card prints no ₪.
 */
export default function AttendanceApprovals({
  data,
  spark,
  projectOptions,
  propertyOptions,
  locale,
}: {
  data: PhoneQueueData;
  /** Shifts started per day over the last week, oldest first. */
  spark?: number[];
  /** What an approved shift can be attributed to — the approve form needs both. */
  projectOptions: SalaryCenterProjectOption[];
  propertyOptions: SalaryCenterProjectOption[];
  locale: Locale;
}) {
  // Which days are UNFOLDED. Days start CLOSED: the card opens as a short list of
  // "which days have shifts waiting, and how many", and you open the one you mean
  // to work through. Four open reports at full height is most of a column spent
  // on forms nobody asked for yet.
  const [openDays, setOpenDays] = useState<Set<string>>(() => new Set());
  const toggleDay = useCallback((day: string) => {
    setOpenDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }, []);

  const { pending, open } = data;
  if (pending.length === 0 && open.length === 0) {
    return (
      <QuietCard
        icon={ClockIcon}
        title={t(dashboardDict, locale, "attendanceCardTitle")}
        note={t(dashboardDict, locale, "attendanceEmptyNote")}
        href={QUEUE_HREF}
      />
    );
  }

  // The head of the queue; the footer's count says how many there are in all.
  const shown = pending.slice(0, SHOWN_LIMIT);

  return (
    // The whole card leads to the queue page, EXCEPT the report rows: those are
    // controls now, and a click meant for a domain select must not navigate away.
    // The link sits underneath as a full-bleed overlay and everything that isn't
    // a report row (header, gaps, the on-shift strip) falls through to it —
    // nesting the rows inside an <a> wouldn't be legal HTML.
    <Card className="relative flex h-full flex-col">
      <Link
        href={QUEUE_HREF}
        aria-label={t(dashboardDict, locale, "attendanceQueueAria")}
        className="absolute inset-0 rounded-[1.125rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />

      <div className="pointer-events-none relative flex min-h-0 flex-1 flex-col">
        <DashboardCardHeader
          icon={ClockIcon}
          title={t(dashboardDict, locale, "attendanceCardTitle")}
          count={pending.length}
          // The anchor is WHO'S ON SHIFT — the card's headline number, now beside
          // the trend instead of under it. One number, one place.
          spark={
            spark ? (
              <Sparkline
                points={spark}
                value={open.length}
                valueLabel={t(dashboardDict, locale, "onShiftLabel")}
                label={t(dashboardDict, locale, "last7DaysLabel")}
              />
            ) : undefined
          }
        />

        {/* p-0, like every other list card: the rows own their padding, so a row's
            hover runs to the card's edges instead of stopping short as a box in
            the middle. Anything that ISN'T a row brings its own margin. */}
        <CardContent className="pointer-events-auto min-h-0 flex-1 overflow-y-auto p-0">
          {/* WHO is on shift. The COUNT moved up beside the sparkline, where it
              anchors the trend — printing it here as well made one card carry the
              same number twice, in two sizes. What's left is the part the number
              can't say: which of them. */}
          {open.length > 0 ? (
            <div className="px-4 pb-3 pt-3">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                {open.map((report) => (
                  <span key={report.id} className="inline-flex items-center gap-1">
                    <InitialsAvatar
                      name={report.worker_name ?? t(dashboardDict, locale, "workerFallback")}
                      color={report.worker_avatar_color}
                      colorKey={report.user_id}
                      size="sm"
                    />
                    <span className="font-medium text-foreground">
                      {report.worker_name ?? t(dashboardDict, locale, "workerUnknownFallback")}
                    </span>
                    <span className="tabular-nums">
                      {formatMinutes(minutesBetween(report.clock_in, new Date()))} {t(dashboardDict, locale, "hoursAbbrev")}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {/* GROUPED BY DAY, so the date is written once per group instead of
              once per report — which is what let each row drop it and give its
              corner to the hours. Reports arrive newest-first, so the groups do.
              divide-y on the GROUPS as well as on the rows: `divide-y` only draws
              BETWEEN children, so the last row of a day had nothing under it and
              the next date heading floated in a gap. */}
          {shown.length > 0 ? (
            <div className="divide-y divide-border/50">
              {groupByDay(shown).map(([day, reports]) => {
                const isOpen = openDays.has(day);
                return (
                  <section key={day}>
                    {/* The date IS the toggle: a day you've dealt with folds away,
                        and folding it makes the CARD shorter — the cells start at
                        their content's height, so the space goes back to the cards
                        beside it rather than sitting empty under this one. */}
                    <button
                      type="button"
                      onClick={() => toggleDay(day)}
                      aria-expanded={isOpen}
                      className="pointer-events-auto flex w-full items-center gap-1.5 border-b border-border/50 px-4 pb-1.5 pt-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-secondary/10 hover:text-foreground"
                    >
                      <ChevronDownIcon
                        className={cn("h-3.5 w-3.5 shrink-0 transition-transform", isOpen ? "rotate-0" : "rotate-90")}
                      />
                      <span>{dayLabel(reports[0].clock_in)}</span>
                      <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums">{reports.length}</span>
                    </button>
                    {isOpen ? (
                      <div className="divide-y divide-border/50">
                        {/* pointer-events-auto per ROW, not on the wrapper: the gaps
                            between rows stay part of the card's own click target. */}
                        {reports.map((report) => (
                          <div key={report.id} className="pointer-events-auto">
                            <PendingReportCard
                              report={report}
                              projectOptions={projectOptions}
                              propertyOptions={propertyOptions}
                              flat
                              // Opens the queue AT this report: FocusHighlighter finds
                              // the matching data-focus-id, scrolls to it, flashes it.
                              href={`${QUEUE_HREF}?focus=${encodeURIComponent(report.id)}`}
                            />
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </section>
                );
              })}
            </div>
          ) : null}
        </CardContent>
        <DashboardCardFooter href={QUEUE_HREF} label={t(dashboardDict, locale, "attendanceFooterLabel")} count={pending.length} />
      </div>
    </Card>
  );
}

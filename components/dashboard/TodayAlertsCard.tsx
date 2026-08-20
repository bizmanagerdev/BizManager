import Link from "next/link";
import { NotificationIcon } from "@/components/ui/icons";
import { Card, CardContent } from "@/components/ui/card";
import DashboardCardHeader from "@/components/dashboard/DashboardCardHeader";
import DashboardCardFooter from "@/components/dashboard/DashboardCardFooter";
import QuietCard from "@/components/dashboard/QuietCard";
import { cn } from "@/lib/utils";
import type { TodayAlert, WorklistSeverity } from "@/lib/reminders/worklist";
import { t } from "@/lib/i18n/t";
import { dashboardDict } from "@/lib/i18n/dictionaries/dashboard";
import type { Locale } from "@/lib/i18n/types";

// DORESH TIPUL — the dated alerts, GROUPED to one line per kind ("צ׳קים
// להפקדה: 5"). Never itemised: five near-identical cheque rows made a quiet day
// look like a heavy one. Grouping happens server-side in todaySlice, because
// it's pure rule knowledge; this card only draws it.
//
// The other half of the old "היום" card — its schedule sibling is
// TodayScheduleCard, which sits beside it at a quarter width each.
//
// The WHOLE card is one link to the inbox (/alerts redirects there — the old
// worklist and the notification history are one list now), so there's no button
// and no per-rule link inside: the lines are a count, and every part of the card
// leads to the page where those items are actually worked off.
//
// Unlike its sibling it hides itself when there's nothing to handle: an empty
// "התראות" card is a panel saying nothing, and the schedule card's own empty
// line already answers "how does my day look".

const DOT: Record<WorklistSeverity, string> = {
  danger: "bg-destructive",
  warning: "bg-warning",
  info: "bg-muted-foreground/40",
};

export default function TodayAlertsCard({
  alerts,
  locale,
}: {
  /** Already grouped server-side to one line per rule — see todaySlice. */
  alerts: TodayAlert[];
  locale: Locale;
}) {
  // No "ועוד N בתיבה" tail: it counted the inbox rows this card deliberately
  // ISN'T about (the undated backlog), which reads as "10 more of these" when
  // it's really "10 of something else". The card links to the inbox anyway.
  if (alerts.length === 0) {
    return (
      <QuietCard
        icon={NotificationIcon}
        title={t(dashboardDict, locale, "alertsCardTitle")}
        note={t(dashboardDict, locale, "alertsEmptyNote")}
        href="/inbox"
      />
    );
  }

  const total = alerts.reduce((sum, alert) => sum + alert.count, 0);

  return (
    // Card → the inbox, each line → the slice of it that line counts. Overlay
    // link (not a wrapper) so the rows can carry their own deep links.
    <Card className="relative flex h-full flex-col">
      <Link
        href="/inbox"
        aria-label={t(dashboardDict, locale, "toInboxAria")}
        className="absolute inset-0 rounded-[1.125rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />

      <div className="pointer-events-none relative flex min-h-0 flex-1 flex-col">
        <DashboardCardHeader icon={NotificationIcon} title={t(dashboardDict, locale, "alertsCardTitle")} count={total} />

        {/* The board's list style: p-0 content, rows that run edge to edge and
            carry their own padding, hairlines between them — same as the
            deliveries and payments cards. */}
        <CardContent className="pointer-events-auto min-h-0 flex-1 overflow-y-auto p-0">
          <ul className="board-list divide-y">
            {alerts.map((alert) => (
              <li key={alert.id} className="relative px-4 py-3 transition-colors hover:bg-secondary/10">
                {/* Covers the row, so the whole line is the target. */}
                <Link
                  href={alert.href}
                  aria-label={alert.title}
                  className="absolute inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <div className="flex items-center gap-2">
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", DOT[alert.severity] ?? DOT.info)} />
                  <span className="truncate text-sm font-medium" title={alert.title}>
                    {alert.title}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
        <DashboardCardFooter href="/inbox" label={t(dashboardDict, locale, "allAlertsFooterLabel")} count={total} />
      </div>
    </Card>
  );
}

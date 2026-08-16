import Link from "next/link";
import { ApprovedUserIcon, ChevronLeftIcon, ClockIcon, PendingIcon } from "@/components/ui/icons";
import type { IconComponent } from "@/components/ui/icons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InitialsAvatar } from "@/components/dashboard/InitialsAvatar";
import QuickAttendanceButton from "@/components/dashboard/QuickAttendanceButton";
import { formatMinutes, minutesBetween } from "@/lib/payroll";
import { formatShortDate } from "@/lib/date";
import { cn } from "@/lib/utils";
import type { PhoneQueueData } from "@/lib/attendance/phone-reports";

/** Where every link on this card lands: the payroll attendance-queue page. */
const QUEUE_HREF = "/payroll/attendance";

/** "יום שני" — the weekday of a timestamp, in Israel time. */
function hebrewWeekday(iso: string) {
  return new Intl.DateTimeFormat("he-IL", { weekday: "long", timeZone: "Asia/Jerusalem" }).format(new Date(iso));
}

/** "08:21" — just the time, in Israel time. */
function timeOnly(iso: string) {
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

function Stat({
  icon: Icon,
  label,
  value,
  tone = "neutral",
}: {
  icon: IconComponent;
  label: string;
  value: string;
  tone?: "neutral" | "warning" | "success";
}) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-background p-3",
        tone === "warning" && "border-warning/40 bg-warning-soft",
        tone === "success" && "border-success/40 bg-success-soft"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <Icon
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground",
            tone === "warning" && "text-warning",
            tone === "success" && "text-success"
          )}
        />
        <span
          className={cn(
            "text-2xl font-bold text-foreground",
            tone === "warning" && "text-warning",
            tone === "success" && "text-success"
          )}
        >
          {value}
        </span>
      </div>
      {/* text-xs, not sm: three tiles across a phone leave ~6rem each, and a
          wider label turns into a two-line stack. */}
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

/**
 * "נוכחות עובדים" — the attendance queue on the dashboard: how many shift
 * reports are waiting to be approved into payroll, who is clocked in right now,
 * and the head of the waiting list. Approval itself needs a business domain per
 * shift, so the rows link into the payroll queue rather than approving here.
 * Counts and hours only — no ₪ on the dashboard.
 */
export default function AttendanceApprovals({ data }: { data: PhoneQueueData }) {
  const { pending, open } = data;
  if (pending.length === 0 && open.length === 0) return null;

  const pendingMinutes = pending.reduce(
    (sum, r) => sum + (r.worked_minutes ?? minutesBetween(r.clock_in, r.clock_out)),
    0
  );
  const shown = pending.slice(0, 4);
  const rest = pending.length - shown.length;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
        <div className="flex items-center gap-2">
          <ClockIcon className="h-5 w-5 text-secondary" />
          <CardTitle className="text-lg">נוכחות עובדים</CardTitle>
          {pending.length > 0 ? <Badge variant="warning">{pending.length} ממתינים לאישור</Badge> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <QuickAttendanceButton />
          <Button asChild size="sm">
            <Link href={QUEUE_HREF}>לתור האישורים</Link>
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <Stat
            icon={PendingIcon}
            label="ממתינים לאישור"
            value={String(pending.length)}
            tone={pending.length > 0 ? "warning" : "neutral"}
          />
          <Stat
            icon={ApprovedUserIcon}
            label="נוכחים כעת"
            value={String(open.length)}
            tone={open.length > 0 ? "success" : "neutral"}
          />
          <Stat icon={ClockIcon} label="שעות ממתינות" value={formatMinutes(pendingMinutes)} />
        </div>

        {open.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-success/40 bg-success-soft px-3 py-2">
            <span className="text-sm font-medium text-success-soft-foreground">במשמרת עכשיו:</span>
            {open.map((report) => (
              <span
                key={report.id}
                className="inline-flex items-center gap-1.5 rounded-full bg-background px-2 py-1 text-sm"
              >
                <InitialsAvatar
                  name={report.worker_name ?? "עובד"}
                  color={report.worker_avatar_color}
                  colorKey={report.user_id}
                  size="sm"
                />
                <span className="font-medium">{report.worker_name ?? "עובד לא ידוע"}</span>
                <span className="text-muted-foreground">
                  {formatMinutes(minutesBetween(report.clock_in, new Date()))} ש׳
                </span>
              </span>
            ))}
          </div>
        ) : null}

        {shown.length > 0 ? (
          <div className="space-y-1.5">
            {shown.map((report) => {
              const minutes = report.worked_minutes ?? minutesBetween(report.clock_in, report.clock_out);
              return (
                <Link
                  key={report.id}
                  href={QUEUE_HREF}
                  className="flex items-center gap-2.5 rounded-xl border border-border/60 px-3 py-2 transition-colors hover:bg-muted/40"
                >
                  <InitialsAvatar
                    name={report.worker_name ?? "עובד"}
                    color={report.worker_avatar_color}
                    colorKey={report.user_id}
                    size="sm"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 text-sm font-medium">
                      {report.worker_name ?? "עובד לא ידוע"}
                      {report.worker_phone ? (
                        <span className="text-xs font-normal text-muted-foreground" dir="ltr">
                          {report.worker_phone}
                        </span>
                      ) : null}
                    </span>
                    {/* "08:21 עד 11:22", never a dash range: the dash is a neutral
                        bidi character and flips the pair on an RTL line, so the end
                        time reads first. Matches SessionList / the queue page. */}
                    <span className="block text-xs text-muted-foreground">
                      {hebrewWeekday(report.clock_in)} {formatShortDate(report.clock_in)} · {timeOnly(report.clock_in)} עד{" "}
                      {timeOnly(report.clock_out)}
                    </span>
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-secondary/10 px-2 py-0.5 text-xs font-semibold text-secondary">
                    <ClockIcon className="h-3 w-3" />
                    {formatMinutes(minutes)}
                  </span>
                  <ChevronLeftIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              );
            })}
            {rest > 0 ? (
              <Link href={QUEUE_HREF} className="block px-3 py-1 text-sm text-secondary hover:underline">
                ועוד {rest} דיווחים ממתינים ›
              </Link>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

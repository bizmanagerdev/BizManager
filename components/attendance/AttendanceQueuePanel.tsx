"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  AddIcon,
  ApprovedUserIcon,
  BlockedIcon,
  CheckIcon,
  ClockIcon,
  CloseIcon,
  CoinsIcon,
  EditIcon,
  LayersIcon,
  LogoutIcon,
  PendingIcon,
  RefreshIcon,
  SaveIcon,
  SuccessIcon,
  UsersIcon,
} from "@/components/ui/icons";
import type { IconComponent } from "@/components/ui/icons";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DeleteButton } from "@/components/ui/icon-button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { CurrencyInput } from "@/components/ui/currency-input";
import { DomainSelect } from "@/components/financial/DomainSelect";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DateTimeInput } from "@/components/ui/date-input";
import { PageHeaderToolbar } from "@/components/layout/PageHeaderToolbar";
import { InitialsAvatar } from "@/components/dashboard/InitialsAvatar";
import { shiftHoursText } from "@/components/attendance/DayTile";
import { AttendanceLogDialog } from "@/components/attendance/AttendanceLogDialog";
import { WORK_SESSION_BUSINESS_DOMAINS } from "@/lib/expenses";
import { formatCurrency, formatMinutes, minutesBetween } from "@/lib/payroll";
import { formatShortDate } from "@/lib/date";
import { toHebrewError } from "@/lib/error-messages";
import { cn } from "@/lib/utils";
import type { OpenPhoneReport, PendingPhoneReport } from "@/lib/attendance/phone-reports";
import { attendanceSourceLabel } from "@/lib/attendance/my-shift";
import type { SalaryCenterProjectOption } from "@/lib/payroll-center";

export type AttendanceWorker = { id: string; name: string | null; phone: string | null };

type Props = {
  pending: PendingPhoneReport[];
  open: OpenPhoneReport[];
  workers: AttendanceWorker[];
  projectOptions: SalaryCenterProjectOption[];
  propertyOptions: SalaryCenterProjectOption[];
};

/** "יום ראשון" … — the full Hebrew weekday of a timestamp, in Israel time. */
function hebrewWeekday(iso: string) {
  return new Intl.DateTimeFormat("he-IL", { weekday: "long", timeZone: "Asia/Jerusalem" }).format(new Date(iso));
}

/**
 * The origin tag, who filed it when that ISN'T the worker himself, and a note —
 * each part only when it adds something. "נרשם ע״י" is the one you want before
 * approving: it's the difference between a worker reporting his own hours and a
 * colleague reporting them for him.
 */
function attendanceMeta(source: string, notes: string | null, reportedByName?: string | null) {
  const parts = [attendanceSourceLabel(source)];
  if (reportedByName) parts.push(`נרשם ע״י ${reportedByName}`);
  const extra = freeTextNote(source, notes);
  if (extra) parts.push(extra);
  return parts.join(" · ");
}

/**
 * What someone actually WROTE about the shift, with the source tag stripped off.
 *
 * The stored note usually OPENS with the source label ("דיווח טלפוני — כניסה
 * מאוחרת"), so an equality check let it through and the row printed the label
 * twice.
 */
function freeTextNote(source: string, notes: string | null) {
  const label = attendanceSourceLabel(source);
  const trimmed = (notes ?? "").trim();
  return trimmed.startsWith(label) ? trimmed.slice(label.length).replace(/^[\s—–\-·:,]+/, "") : trimmed;
}

/** Within the hour after this timestamp — the window in which "he actually
 *  carried on working" is still a live possibility. */
function withinLastHour(iso: string) {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && Date.now() - t < 60 * 60 * 1000;
}

/** Current local time as a datetime-local value ("YYYY-MM-DDTHH:mm") for DateTimeInput defaults. */
function nowLocal() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** An ISO timestamp as a local datetime-local value, to prefill an editor with an existing time. */
function isoToLocal(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * One number in the summary strip. Deliberately a compact inline chip, not a
 * card: four stat CARDS would push the first report you actually have to act on
 * below the fold.
 */
function QueueStat({
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
        "rounded-xl border bg-background px-2.5 py-1.5",
        tone === "warning" && "border-warning/40 bg-warning-soft",
        tone === "success" && "border-success/40 bg-success-soft"
      )}
    >
      {/* Label above, number below — NOT side by side. In a half-width grid cell a
          side-by-side chip squeezes a long label ("עלות שכר ממתינה") down to a
          one-character-per-line column. */}
      <div className="flex items-center gap-1.5">
        <Icon
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground",
            tone === "warning" && "text-warning",
            tone === "success" && "text-success"
          )}
        />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <div
        className={cn(
          "ps-5 text-base font-bold text-foreground",
          tone === "warning" && "text-warning",
          tone === "success" && "text-success"
        )}
      >
        {value}
      </div>
    </div>
  );
}

/**
 * "דיווחי נוכחות" — the full attendance queue as its own page.
 * Two groups: workers clocked in right now, and clocked-out reports waiting for
 * an admin to classify into a business domain and approve into a real session.
 * Nothing here counts toward payroll until it's approved.
 */
export default function AttendanceQueuePanel({
  pending,
  open,
  workers,
  projectOptions,
  propertyOptions,
}: Props) {
  const [logOpen, setLogOpen] = useState(false);
  const [workerFilter, setWorkerFilter] = useState("");
  // Same dialog as the dashboard's "דיווח נוכחות" quick action.
  const dialogWorkers = useMemo(() => workers.map((w) => ({ id: w.id, label: w.name ?? "עובד" })), [workers]);

  // Only workers who actually appear in the queue are worth filtering by.
  const filterOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const row of [...pending, ...open]) {
      if (!byId.has(row.user_id)) byId.set(row.user_id, row.worker_name ?? "עובד לא ידוע");
    }
    return [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1], "he"));
  }, [pending, open]);

  const shownPending = workerFilter ? pending.filter((r) => r.user_id === workerFilter) : pending;
  const shownOpen = workerFilter ? open.filter((r) => r.user_id === workerFilter) : open;
  const openUserIds = useMemo(() => new Set(open.map((r) => r.user_id)), [open]);

  const pendingMinutes = pending.reduce(
    (sum, r) => sum + (r.worked_minutes ?? minutesBetween(r.clock_in, r.clock_out)),
    0
  );
  // Cost is salary data — null for viewers who may not see it, and then the tile
  // stays off rather than showing a misleading ₪0.
  const costedReports = pending.filter((r) => r.labor_cost != null);
  const pendingCost = costedReports.reduce((sum, r) => sum + (r.labor_cost ?? 0), 0);

  // No useSetPageTitle here: the route title ("דיווחי נוכחות" in route-titles.ts)
  // already names the page, and a count subtitle only repeats the first stat chip.
  const workerFilterSelect =
    filterOptions.length > 1 ? (
      <>
        <option value="">כל העובדים</option>
        {filterOptions.map(([id, name]) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </>
    ) : null;

  return (
    <div className="space-y-3">
      {/* Mobile: the + and the worker filter ride INSIDE the dark header, the way
          the orders / customers / projects pages do it, so the queue starts right
          under the bar instead of below a second toolbar strip. */}
      <PageHeaderToolbar>
        <div className="mx-auto flex w-full max-w-md items-center justify-center gap-2">
          <Button
            type="button"
            aria-label="דיווח נוכחות"
            className="h-10 shrink-0 gap-1 rounded-xl px-3"
            onClick={() => setLogOpen(true)}
          >
            <AddIcon className="h-4 w-4" />
            <span className="text-xs">דיווח</span>
          </Button>
          {workerFilterSelect ? (
            <NativeSelect
              value={workerFilter}
              onChange={(e) => setWorkerFilter(e.target.value)}
              aria-label="סינון לפי עובד"
              className="h-10 w-full min-w-0 max-w-[13rem] rounded-xl border-white/10 bg-white/[0.06] text-sidebar-foreground shadow-none focus-visible:bg-white/[0.12] focus-visible:ring-1 focus-visible:ring-white/25"
            >
              {workerFilterSelect}
            </NativeSelect>
          ) : null}
        </div>
      </PageHeaderToolbar>

      {/* Header + summary strip — one compact band, so the queue itself starts high
          on the page instead of below four stat cards. */}
      <div className="space-y-2 rounded-2xl border border-secondary/25 bg-secondary/5 px-3 py-3 sm:px-4">
        {/* Totals first — they're what you read; the controls sit under them.
            A GRID on phones, not wrap: four chips of different widths wrapping
            produced a right-aligned staircase. */}
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <QueueStat
            icon={PendingIcon}
            label="ממתינים לאישור"
            value={String(pending.length)}
            tone={pending.length > 0 ? "warning" : "neutral"}
          />
          <QueueStat
            icon={ApprovedUserIcon}
            label="נוכחים כעת"
            value={String(open.length)}
            tone={open.length > 0 ? "success" : "neutral"}
          />
          <QueueStat icon={ClockIcon} label="שעות ממתינות" value={formatMinutes(pendingMinutes)} />
          {costedReports.length > 0 ? (
            <QueueStat icon={CoinsIcon} label="עלות שכר ממתינה" value={formatCurrency(pendingCost)} />
          ) : (
            <QueueStat icon={UsersIcon} label="עובדים בתור" value={String(filterOptions.length)} />
          )}
        </div>

        {/* Desktop only — on phones these same two controls live in the dark
            header above (PageHeaderToolbar is md:hidden). */}
        <div className="hidden items-center gap-2 md:flex">
          {workerFilterSelect ? (
            <NativeSelect
              dense
              value={workerFilter}
              onChange={(e) => setWorkerFilter(e.target.value)}
              aria-label="סינון לפי עובד"
              className="w-44"
            >
              {workerFilterSelect}
            </NativeSelect>
          ) : null}
          {/* The one way to ADD a shift from here: sign a worker in/out now, or
              record a whole past shift ("רישום ידני") — both land in this queue. */}
          <Button type="button" size="sm" onClick={() => setLogOpen(true)}>
            <AddIcon className="h-4 w-4" />
            דיווח נוכחות
          </Button>
        </div>
      </div>

      {shownOpen.length > 0 ? (
        <section className="space-y-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-success" />
            נוכחים כעת ({shownOpen.length})
          </h3>
          <div className="space-y-2">
            {shownOpen.map((report) => (
              <OpenRow key={report.id} report={report} />
            ))}
          </div>
        </section>
      ) : null}

      {shownPending.length > 0 ? (
        <section className="space-y-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-warning" />
            ממתינים לאישור ({shownPending.length})
          </h3>
          <div className="space-y-2">
            {shownPending.map((report) => (
              <ReportCard
                key={report.id}
                report={report}
                projectOptions={projectOptions}
                propertyOptions={propertyOptions}
                // Edge case, deliberately quiet: he clocked out and then carried
                // on working, so the close is undone and THIS shift continues.
                // Only for an hour after the clock-out, and only while he has no
                // open shift — otherwise it bounces off the one-open-per-worker
                // index anyway.
                canReopen={!openUserIds.has(report.user_id) && withinLastHour(report.clock_out)}
              />
            ))}
          </div>
        </section>
      ) : null}

      {shownPending.length === 0 && shownOpen.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-success/40 bg-success-soft px-4 py-8 text-center">
          <SuccessIcon className="h-6 w-6 text-success" />
          <p className="text-sm font-medium text-success-soft-foreground">
            {workerFilter ? "אין דיווחים לעובד שנבחר." : "אין דיווחי נוכחות ממתינים."}
          </p>
          <p className="text-sm text-muted-foreground">אפשר לדווח נוכחות לעובד ידנית בעזרת «דיווח נוכחות».</p>
        </div>
      ) : null}

      <AttendanceLogDialog open={logOpen} onOpenChange={setLogOpen} workers={dialogWorkers} />
    </div>
  );
}

/** Card head shared by both rows: avatar, name, phone. */
function WorkerHead({
  name,
  phone,
  userId,
  avatarColor,
  clockIn,
  clockOut,
  duration,
  meta,
  chips,
  cost,
}: {
  name: string | null;
  phone: string | null;
  userId: string;
  /** The worker's own users.avatar_color — same circle they wear everywhere else. */
  avatarColor: string | null;
  clockIn: string;
  /** Null while the shift is still open. */
  clockOut?: string | null;
  /** "3:01 שעות" / "כבר 3:01 שעות" for an open shift. */
  duration: string;
  /** Origin / who filed it / note. */
  meta: string;
  /** Top-left corner, opposite the person chip — the weekday + date. */
  chips?: ReactNode;
  /** Far end of the shift row, after the description — the shift's labor cost. */
  cost?: ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      {/* WHO + WHEN. One person chip — the avatar with the name over the phone
          beside it — so the identity reads as a single object, with the date
          alone in the opposite corner. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 rounded-xl border border-border/60 bg-muted/40 py-1 pe-2.5 ps-1.5">
          <InitialsAvatar name={name ?? "עובד"} color={avatarColor} colorKey={userId} size="sm" />
          <span className="leading-tight">
            <span className="block text-sm font-semibold text-foreground">{name ?? "עובד לא ידוע"}</span>
            {phone ? (
              <span className="block text-xs text-muted-foreground" dir="ltr">
                {phone}
              </span>
            ) : null}
          </span>
        </span>
        {chips ? <div className="flex flex-wrap items-center justify-end gap-1.5">{chips}</div> : null}
      </div>

      {/* The hours row — no day tile: the badge above already carries the weekday
          and the full date, so the tile only said it a second time. The cost sits
          at the far end, after the description, rather than crowding the date. */}
      <div className="flex items-start gap-2">
        <div className="shrink-0 text-xs leading-tight tabular-nums">
          <div className="font-semibold text-foreground">{duration}</div>
          <div className="text-muted-foreground">{shiftHoursText(clockIn, clockOut)}</div>
        </div>
        {/* Same slot SessionList gives the project/domain: how this shift got here. */}
        {meta ? <div className="min-w-0 flex-1 text-xs text-muted-foreground">{meta}</div> : null}
        {cost ? <div className="ms-auto shrink-0">{cost}</div> : null}
      </div>
    </div>
  );
}

/** A worker currently clocked in (open shift). Admin can close it now / at a set time → pending. */
function OpenRow({ report }: { report: OpenPhoneReport }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [closing, setClosing] = useState(false);
  const [closeLocal, setCloseLocal] = useState(() => nowLocal());
  /** "מה העובד עשה" — the same thing the worker writes when closing his own shift. */
  const [closeNote, setCloseNote] = useState("");
  const [editing, setEditing] = useState(false);
  const [entryLocal, setEntryLocal] = useState(() => isoToLocal(report.clock_in));
  const [error, setError] = useState("");
  const elapsed = minutesBetween(report.clock_in, new Date());

  function saveEntry() {
    setError("");
    const clockIn = new Date(entryLocal);
    if (!entryLocal || Number.isNaN(clockIn.getTime())) return setError("שעת כניסה אינה תקינה.");
    if (clockIn.getTime() > Date.now() + 60_000) return setError("שעת הכניסה לא יכולה להיות בעתיד.");

    startTransition(async () => {
      try {
        const response = await fetch("/api/attendance/phone-reports/update-entry", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ report_id: report.id, clock_in: clockIn.toISOString() }),
        });
        const json = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) return setError(toHebrewError(json.error, "עדכון שעת הכניסה נכשל."));
        toast.success("שעת הכניסה עודכנה.");
        setEditing(false);
        router.refresh();
      } catch (err: unknown) {
        setError(toHebrewError(err, "עדכון שעת הכניסה נכשל."));
      }
    });
  }

  function closeShift() {
    setError("");
    const clockOut = new Date(closeLocal);
    if (!closeLocal || Number.isNaN(clockOut.getTime())) return setError("שעת יציאה אינה תקינה.");
    if (clockOut <= new Date(report.clock_in)) return setError("שעת היציאה חייבת להיות אחרי הכניסה.");

    startTransition(async () => {
      try {
        const response = await fetch("/api/attendance/phone-reports/close", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            report_id: report.id,
            clock_out: clockOut.toISOString(),
            notes: closeNote.trim() || null,
          }),
        });
        const json = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) return setError(toHebrewError(json.error, "סגירת המשמרת נכשלה."));
        toast.success("המשמרת נסגרה וממתינה לאישור.");
        router.refresh();
      } catch (err: unknown) {
        setError(toHebrewError(err, "סגירת המשמרת נכשלה."));
      }
    });
  }

  return (
    <div className="rounded-xl border border-success/40 bg-card px-3 py-2 shadow-sm">
      <WorkerHead
        name={report.worker_name}
        phone={report.worker_phone}
        userId={report.user_id}
        avatarColor={report.worker_avatar_color}
        clockIn={report.clock_in}
        duration={`כבר ${formatMinutes(elapsed)} שעות`}
        meta={attendanceMeta(report.source, report.notes, report.reported_by_name)}
        chips={<Badge variant="success">נוכח</Badge>}
      />
      {!closing && !editing ? (
        <div className="mt-2 flex flex-wrap items-center justify-end gap-2 border-t border-border/60 pt-2">
          {/* Same rule as the pending card: glyph only on a phone, glyph + word
              from `sm` up, so a narrow row never wraps or overflows. */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="px-2 sm:px-3"
            aria-label="עריכת שעת הכניסה"
            title="עריכת שעת הכניסה"
            onClick={() => {
              setEntryLocal(isoToLocal(report.clock_in));
              setError("");
              setEditing(true);
            }}
          >
            <EditIcon className="h-4 w-4" />
            <span className="hidden sm:inline">עריכת כניסה</span>
          </Button>
          <Button
            type="button"
            size="sm"
            className="px-2 sm:px-3"
            aria-label="סגירת המשמרת"
            title="סגירת המשמרת"
            onClick={() => {
              setCloseLocal(nowLocal());
              setError("");
              setClosing(true);
            }}
          >
            <LogoutIcon className="h-4 w-4" />
            <span className="hidden sm:inline">סגירת משמרת</span>
          </Button>
        </div>
      ) : null}

      {editing ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border/60 pt-2">
          <span className="text-sm text-muted-foreground">שעת כניסה:</span>
          <div className="w-44">
            <DateTimeInput value={entryLocal} onChange={(e) => setEntryLocal(e.target.value)} />
          </div>
          <Button type="button" size="sm" onClick={saveEntry} disabled={isPending}>
            <SaveIcon className="h-4 w-4" />
            {isPending ? "..." : "שמירה"}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)} disabled={isPending}>
            <CloseIcon className="h-4 w-4" />
            ביטול
          </Button>
          {error ? <span className="text-sm text-destructive">{error}</span> : null}
        </div>
      ) : null}

      {closing ? (
        <div className="mt-2 space-y-2 border-t border-border/60 pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">שעת יציאה:</span>
            <div className="w-44">
              <DateTimeInput value={closeLocal} onChange={(e) => setCloseLocal(e.target.value)} />
            </div>
          </div>
          {/* The same question the worker answers when closing his own shift
              ("מה עשית במשמרת?"), so a shift closed by the office isn't the one
              that reaches approval with nothing written on it. */}
          <label className="block space-y-1">
            <span className="block text-xs text-muted-foreground">מה העובד עשה במשמרת?</span>
            <Textarea value={closeNote} onChange={(e) => setCloseNote(e.target.value)} rows={2} disabled={isPending} />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" onClick={closeShift} disabled={isPending}>
              <LogoutIcon className="h-4 w-4" />
              {isPending ? "..." : "סגירה"}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setClosing(false)} disabled={isPending}>
              <CloseIcon className="h-4 w-4" />
              ביטול
            </Button>
            {error ? <span className="text-sm text-destructive">{error}</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

type PartDraft = {
  id: string;
  domain: string;
  projectId: string;
  propertyId: string;
  billable: boolean;
  billAmount: string;
  hours: string; // split duration for this part (ignored for the last / only part)
};

function blankPart(): PartDraft {
  return {
    id: `p-${Math.random().toString(36).slice(2, 8)}`,
    domain: "",
    projectId: "",
    propertyId: "",
    billable: false,
    billAmount: "",
    hours: "",
  };
}

function ReportCard({
  report,
  projectOptions,
  propertyOptions,
  canReopen = false,
}: {
  report: PendingPhoneReport;
  projectOptions: SalaryCenterProjectOption[];
  propertyOptions: SalaryCenterProjectOption[];
  /** Offer to put the worker back on the clock from this shift's clock-out. */
  canReopen?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // No description field here on purpose: what the worker did is written at
  // CLOCK-OUT (by him, or by whoever closes the shift for him), and the approve
  // route carries that note onto the session. Approving is a classification
  // decision, not a place to write the shift up after the fact.
  const [parts, setParts] = useState<PartDraft[]>([blankPart()]);
  const [error, setError] = useState("");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const totalMinutes = report.worked_minutes ?? minutesBetween(report.clock_in, report.clock_out);
  const split = parts.length > 1;
  const canSplit = totalMinutes >= 2;
  // A shift past midnight is shown by the DayTile's "30–31" span, same as the
  // worker card — no separate date-range text to get flipped by bidi.

  const projectSelectOptions = useMemo(() => projectOptions.map((o) => ({ value: o.id, label: o.label })), [projectOptions]);
  const propertySelectOptions = useMemo(() => propertyOptions.map((o) => ({ value: o.id, label: o.label })), [propertyOptions]);

  // Minutes for each non-last part (from its hours field); the last part gets the remainder.
  const nonLastMinutes = parts.slice(0, -1).map((p) => Math.round((Number(p.hours) || 0) * 60));
  const remainderMinutes = totalMinutes - nonLastMinutes.reduce((a, b) => a + b, 0);
  const overAllocated = split && remainderMinutes <= 0;

  const partMinutesAt = (index: number) => (split ? (index === parts.length - 1 ? remainderMinutes : nonLastMinutes[index]) : totalMinutes);
  // The worker's pay for a part, prorated from the whole-shift cost by its share of the minutes.
  const partCostAt = (index: number): number | null => {
    if (report.labor_cost == null || totalMinutes <= 0) return null;
    return Math.round((report.labor_cost * Math.max(0, partMinutesAt(index))) / totalMinutes);
  };

  function updatePart(index: number, patch: Partial<PartDraft>) {
    setError("");
    setParts((current) => current.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }
  function addPart() {
    setError("");
    setParts((current) => [...current, blankPart()]);
  }
  function removePart(index: number) {
    setError("");
    setParts((current) => (current.length <= 1 ? current : current.filter((_, i) => i !== index)));
  }

  function approve() {
    setError("");
    for (let i = 0; i < parts.length; i += 1) {
      const p = parts[i];
      const label = split ? ` (חלק ${i + 1})` : "";
      if (!p.domain) return setError(`יש לבחור תחום עסקי${label}.`);
      if (p.domain === "logistics_projects" && !p.projectId) return setError(`יש לבחור פרויקט${label}.`);
      if (p.domain === "property_management" && !p.propertyId) return setError(`יש לבחור נכס${label}.`);
      if (p.domain === "logistics_projects" && p.billable) {
        const amount = Number(p.billAmount);
        if (!p.billAmount.trim() || !Number.isFinite(amount) || amount <= 0) return setError(`יש להזין סכום חיוב ללקוח תקין${label}.`);
      }
      if (split && i < parts.length - 1 && !(Number(p.hours) > 0)) return setError(`יש להזין משך תקין${label}.`);
    }
    if (overAllocated) return setError("סכום החלקים חורג ממשך המשמרת — צמצם את החלקים.");

    const payloadParts = parts.map((p, i) => ({
      business_domain: p.domain,
      project_id: p.domain === "logistics_projects" ? p.projectId : null,
      property_id: p.domain === "property_management" ? p.propertyId : null,
      is_billable_to_customer: p.domain === "logistics_projects" && p.billable,
      bill_to_customer_amount: p.domain === "logistics_projects" && p.billable ? Number(p.billAmount) : null,
      minutes: split && i < parts.length - 1 ? nonLastMinutes[i] : undefined,
    }));

    startTransition(async () => {
      try {
        const response = await fetch("/api/attendance/phone-reports/approve", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ report_id: report.id, parts: payloadParts }),
        });
        const json = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) return setError(toHebrewError(json.error, "אישור הדיווח נכשל."));
        toast.success(split ? "הדיווח אושר ופוצל למשמרות." : "הדיווח אושר ונרשם כמשמרת.");
        router.refresh();
      } catch (err: unknown) {
        setError(toHebrewError(err, "אישור הדיווח נכשל."));
      }
    });
  }

  /** He clocked out and kept working: undo the close so THIS shift carries on,
   *  rather than starting a second one that would be approved separately. */
  function reopen() {
    setError("");
    startTransition(async () => {
      try {
        const response = await fetch("/api/attendance/phone-reports/reopen", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ report_id: report.id }),
        });
        const json = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) return setError(toHebrewError(json.error, "פתיחת המשמרת מחדש נכשלה."));
        toast.success("המשמרת נפתחה מחדש והעובד חזר לנוכחים.");
        router.refresh();
      } catch (err: unknown) {
        setError(toHebrewError(err, "פתיחת המשמרת מחדש נכשלה."));
      }
    });
  }

  function reject() {
    setError("");
    startTransition(async () => {
      try {
        const response = await fetch("/api/attendance/phone-reports/reject", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ report_id: report.id, reason: rejectReason.trim() || null }),
        });
        const json = (await response.json().catch(() => ({}))) as { error?: string };
        setRejectOpen(false);
        if (!response.ok) return setError(toHebrewError(json.error, "דחיית הדיווח נכשלה."));
        toast.success("הדיווח נדחה.");
        router.refresh();
      } catch (err: unknown) {
        setRejectOpen(false);
        setError(toHebrewError(err, "דחיית הדיווח נכשלה."));
      }
    });
  }

  const partFields = (index: number) => (
    <>
      <DomainSelect
        value={parts[index].domain}
        onChange={(next) => updatePart(index, { domain: next, projectId: "", propertyId: "", billable: false, billAmount: "" })}
        domains={WORK_SESSION_BUSINESS_DOMAINS}
        placeholder="בחירת תחום"
        ariaLabel="תחום עסקי"
        className="h-9 w-full px-3 py-0 sm:w-40"
      />
      {parts[index].domain === "logistics_projects" ? (
        <SearchableSelect
          options={projectSelectOptions}
          value={parts[index].projectId}
          onChange={(v) => updatePart(index, { projectId: v })}
          placeholder="בחירת פרויקט"
          ariaLabel="פרויקט"
          className="h-9 w-full px-3 py-0 sm:w-48"
        />
      ) : null}
      {parts[index].domain === "property_management" ? (
        <SearchableSelect
          options={propertySelectOptions}
          value={parts[index].propertyId}
          onChange={(v) => updatePart(index, { propertyId: v })}
          placeholder="בחירת נכס"
          ariaLabel="נכס"
          className="h-9 w-full px-3 py-0 sm:w-48"
        />
      ) : null}
      {/* Bill to customer — only for project work. */}
      {parts[index].domain === "logistics_projects" ? (
        <>
          <NativeSelect
            value={parts[index].billable ? "yes" : "no"}
            onChange={(e) => {
              // Default the billed amount to what the shift part costs (labor) — editable.
              const billable = e.target.value === "yes";
              const cost = partCostAt(index);
              updatePart(index, { billable, billAmount: billable && cost != null ? String(cost) : "" });
            }}
            aria-label="חיוב ללקוח"
            // `dense` rather than a hand-rolled h-9: forcing the height while the
            // base keeps its py-2/text-base clipped the descenders off ק and ן.
            dense
            className="w-full sm:w-40"
          >
            <option value="no">ללא חיוב ללקוח</option>
            <option value="yes">חיוב ללקוח</option>
          </NativeSelect>
          {parts[index].billable ? (
            <CurrencyInput
              value={parts[index].billAmount}
              onChange={(e) => updatePart(index, { billAmount: e.target.value })}
              placeholder="סכום לחיוב"
              containerClassName="w-full sm:w-32"
            />
          ) : null}
        </>
      ) : null}
    </>
  );

  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2 shadow-sm">
      {/* Who / when / how it got here — the WHEN block is the same shift row the
          worker card shows, so one shift reads identically on both screens. */}
      <WorkerHead
        name={report.worker_name}
        phone={report.worker_phone}
        userId={report.user_id}
        avatarColor={report.worker_avatar_color}
        clockIn={report.clock_in}
        clockOut={report.clock_out}
        duration={`${formatMinutes(totalMinutes)} שעות`}
        meta={attendanceMeta(report.source, report.notes, report.reported_by_name)}
        chips={
          <Badge variant="neutral">
            {hebrewWeekday(report.clock_in)} {formatShortDate(report.clock_in)}
          </Badge>
        }
        cost={
          report.labor_cost != null ? (
            <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-sm font-semibold text-foreground">
              {formatCurrency(report.labor_cost)}
            </span>
          ) : null
        }
      />

      {/* Row 2 — classify and act on ONE line. The overwhelming case is a
          single-domain shift; splitting is the exception and gets its own block. */}
      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border/60 pt-2">
        {split ? <span className="text-sm text-muted-foreground">מפוצל ל-{parts.length} תחומים</span> : partFields(0)}
        <div className="ms-auto flex items-center gap-1.5">
          {/* Four actions don't fit a phone row as icon+word, so the WORD is what
              gives: glyph only under `sm`, glyph + word above it. Every button
              behaves the same way, so they still read as one set at any width, and
              aria-label/title carry the Hebrew name either way. */}
          {canSplit ? (
            // The icon is Layers (one shift becoming several stacked parts); the
            // Split glyph read as a road fork.
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="px-2 sm:px-3"
              onClick={addPart}
              aria-label={split ? "הוסף תחום" : "פיצול לתחומים"}
              title={split ? "הוסף תחום" : "פיצול לתחומים"}
            >
              {split ? <AddIcon className="h-4 w-4" /> : <LayersIcon className="h-4 w-4" />}
              <span className="hidden sm:inline">{split ? "הוסף תחום" : "פיצול"}</span>
            </Button>
          ) : null}
          {canReopen ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="px-2 sm:px-3"
              onClick={reopen}
              disabled={isPending}
              aria-label="החזרה למשמרת פתוחה — העובד ממשיך לעבוד"
              title="החזרה למשמרת פתוחה — העובד ממשיך לעבוד"
            >
              <RefreshIcon className="h-4 w-4" />
              <span className="hidden sm:inline">פתיחה מחדש</span>
            </Button>
          ) : null}
          {/* Outline ONLY — red border on the card's own background, no tinted
              fill. Same recipe as DeleteButton (ghost + border-destructive, NOT
              the destructive-outline variant, which carries bg-destructive-soft). */}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="border border-destructive bg-transparent px-2 text-destructive shadow-none hover:bg-destructive/10 sm:px-3"
            onClick={() => setRejectOpen(true)}
            disabled={isPending}
            aria-label="דחיית הדיווח"
            title="דחיית הדיווח"
          >
            <BlockedIcon className="h-4 w-4" />
            <span className="hidden sm:inline">דחייה</span>
          </Button>
          <Button
            type="button"
            size="sm"
            className="px-2 sm:px-3"
            onClick={approve}
            disabled={isPending}
            aria-label="אישור הדיווח"
            title="אישור הדיווח"
          >
            <CheckIcon className="h-4 w-4" />
            {isPending ? "..." : "אישור"}
          </Button>
        </div>
      </div>

      {split ? (
        <div className="mt-2 space-y-2">
          {parts.map((part, index) => {
            const isLast = index === parts.length - 1;
            return (
              <div key={part.id} className="space-y-2 rounded-xl border border-border/70 bg-muted/30 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    חלק {index + 1}
                    {partCostAt(index) != null ? <span className="mr-2 font-semibold text-foreground">{formatCurrency(partCostAt(index)!)}</span> : null}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {isLast ? (
                      <span className={cn("text-sm", overAllocated ? "font-medium text-destructive" : "text-muted-foreground")}>
                        {overAllocated ? "חריגה — צמצם" : `יתרה ${formatMinutes(remainderMinutes)} ש׳`}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1">
                        <Input
                          value={part.hours}
                          onChange={(e) => updatePart(index, { hours: e.target.value })}
                          inputMode="decimal"
                          placeholder="0"
                          className="h-8 w-16 text-center"
                          aria-label={`משך חלק ${index + 1} בשעות`}
                        />
                        <span className="text-sm text-muted-foreground">ש׳</span>
                      </span>
                    )}
                    <DeleteButton onClick={() => removePart(index)} label="הסרת חלק" />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">{partFields(index)}</div>
              </div>
            );
          })}
        </div>
      ) : null}

      {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}

      <ConfirmDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        title="דחיית דיווח נוכחות"
        description="הדיווח יידחה ולא ייכנס כמשמרת. אפשר לרשום סיבה (לא חובה)."
        confirmLabel="דחה דיווח"
        destructive
        loading={isPending}
        onConfirm={reject}
      >
        <Textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="סיבת הדחייה" rows={2} />
      </ConfirmDialog>
    </div>
  );
}

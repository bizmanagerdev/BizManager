"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ApprovedUserIcon,
  ClockIcon,
  CloseIcon,
  CoinsIcon,
  DocumentIcon,
  EditIcon,
  LogoutIcon,
  PendingIcon,
  SaveIcon,
  SuccessIcon,
  UsersIcon,
} from "@/components/ui/icons";
import type { IconComponent } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { DateTimeInput } from "@/components/ui/date-input";
import { DictateButton } from "@/components/ui/dictate-button";
import { appendDictatedText } from "@/lib/dictation";
import { PageHeaderToolbar } from "@/components/layout/PageHeaderToolbar";
// One approve/reject/split card, shared with the dashboard's נוכחות עובדים widget.
import PendingReportCard, { WorkerHead, attendanceDetail, attendanceMeta } from "@/components/attendance/PendingReportCard";
import { closePhoneReport, updatePhoneReportClockIn } from "@/lib/attendance/phoneReportActions";
import { AttendanceGuideDialog } from "@/components/attendance/AttendanceGuideDialog";
import { formatCurrency, formatMinutes, minutesBetween } from "@/lib/payroll";
import { toHebrewError } from "@/lib/error-messages";
import { cn } from "@/lib/utils";
import type { OpenPhoneReport, PendingPhoneReport } from "@/lib/attendance/phone-reports";
import type { SalaryCenterProjectOption } from "@/lib/payroll-center";
import { useUndoOverlay } from "@/hooks/useUndoOverlay";
import { scheduleDeferredDelete, scheduleDeferredEdit } from "@/lib/undo-engine";


type Props = {
  pending: PendingPhoneReport[];
  open: OpenPhoneReport[];
  projectOptions: SalaryCenterProjectOption[];
  propertyOptions: SalaryCenterProjectOption[];
};

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
  pending: pendingProp,
  open: openProp,
  projectOptions,
  propertyOptions,
}: Props) {
  // Overlaid so a close/reject/reopen/edit anywhere below (this panel or
  // PendingReportCard) can hide/patch a row optimistically without a local copy.
  const pending = useUndoOverlay(pendingProp, (r) => r.id, "phone-report-pending");
  const open = useUndoOverlay(openProp, (r) => r.id, "phone-report-open");
  const [workerFilter, setWorkerFilter] = useState("");
  const [guideOpen, setGuideOpen] = useState(false);
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
      {/* Mobile: the worker filter rides INSIDE the dark header, the way the
          orders / customers / projects pages do it, so the queue starts right
          under the bar instead of below a second toolbar strip. No + here —
          "דיווח נוכחות" is a tile in the app's one quick-create +. */}
      <PageHeaderToolbar>
        <div className="mx-auto flex w-full max-w-md items-center justify-center gap-2">
          {workerFilterSelect ? (
            <NativeSelect
              value={workerFilter}
              onChange={(e) => setWorkerFilter(e.target.value)}
              aria-label="סינון לפי עובד"
              className="h-10 w-full min-w-0 max-w-[13rem] rounded-xl"
            >
              {workerFilterSelect}
            </NativeSelect>
          ) : null}
          <Button
            type="button"
            variant="outline"
            onClick={() => setGuideOpen(true)}
            className="h-10 shrink-0 rounded-xl"
            aria-label="מדריך לעובדים להדפסה"
          >
            <DocumentIcon className="h-4 w-4" />
            מדריך
          </Button>
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

        {/* Desktop only — on phones these same controls live in the dark header
            above (PageHeaderToolbar is md:hidden). Adding a report itself lives in
            the app's one quick-create + ("דיווח נוכחות"). */}
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
          <Button type="button" variant="outline" size="sm" onClick={() => setGuideOpen(true)}>
            <DocumentIcon className="h-4 w-4" />
            מדריך לעובדים
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
              <PendingReportCard
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

      <AttendanceGuideDialog open={guideOpen} onOpenChange={setGuideOpen} />
    </div>
  );
}

/** A worker currently clocked in (open shift). Admin can close it now / at a set time → pending. */
function OpenRow({ report }: { report: OpenPhoneReport }) {
  const router = useRouter();
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

    setEditing(false);
    scheduleDeferredEdit({
      scope: "phone-report-open",
      id: report.id,
      message: "שעת הכניסה עודכנה.",
      patch: { clock_in: clockIn.toISOString() },
      onCommit: async () => {
        const result = await updatePhoneReportClockIn(report.id, clockIn);
        if (!result.ok) return { ok: false, error: toHebrewError(result.error, "עדכון שעת הכניסה נכשל.") };
        router.refresh();
        return { ok: true };
      },
    });
  }

  function closeShift() {
    setError("");
    const clockOut = new Date(closeLocal);
    if (!closeLocal || Number.isNaN(clockOut.getTime())) return setError("שעת יציאה אינה תקינה.");
    if (clockOut <= new Date(report.clock_in)) return setError("שעת היציאה חייבת להיות אחרי הכניסה.");

    const noteSnapshot = closeNote.trim();
    setClosing(false);
    scheduleDeferredDelete({
      scope: "phone-report-open",
      id: report.id,
      message: "המשמרת נסגרה וממתינה לאישור.",
      onCommit: async () => {
        const result = await closePhoneReport(report.id, clockOut, noteSnapshot);
        if (!result.ok) return { ok: false, error: toHebrewError(result.error, "סגירת המשמרת נכשלה.") };
        router.refresh();
        return { ok: true };
      },
    });
  }

  return (
    <div className="rounded-xl border border-success/40 bg-card px-3 py-2 shadow-sm">
      <WorkerHead
        name={report.worker_name}
        phone={report.worker_phone}
        clockIn={report.clock_in}
        duration={`כבר ${formatMinutes(elapsed)} שעות`}
        // This queue is admin/office-only, who never read Arabic — prefer the
        // Hebrew translation when one exists.
        meta={attendanceDetail(report.source, report.notes_he ?? report.notes)}
        metaTitle={attendanceMeta(report.source, report.notes_he ?? report.notes, report.reported_by_name)}
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
          <Button type="button" size="sm" onClick={saveEntry}>
            <SaveIcon className="h-4 w-4" />
            שמירה
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)}>
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
            <div className="relative">
              <Textarea value={closeNote} onChange={(e) => setCloseNote(e.target.value)} rows={2} className="pe-11" />
              <DictateButton
                onTranscript={(text) => setCloseNote((prev) => appendDictatedText(prev, text))}
                className="absolute bottom-1 end-1 h-8 w-8"
              />
            </div>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" onClick={closeShift}>
              <LogoutIcon className="h-4 w-4" />
              סגירה
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setClosing(false)}>
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

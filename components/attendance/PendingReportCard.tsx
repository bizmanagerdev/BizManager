"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AddIcon, BlockedIcon, ChevronDownIcon, EditIcon, LayersIcon, RefreshIcon } from "@/components/ui/icons";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DeleteButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { CurrencyInput } from "@/components/ui/currency-input";
import { DictateButton } from "@/components/ui/dictate-button";
import { appendDictatedText } from "@/lib/dictation";
import { DomainSelect } from "@/components/financial/DomainSelect";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { shiftHoursText } from "@/components/attendance/DayTile";
import { usePendingReportEdit, PendingReportEditFields } from "@/components/attendance/usePendingReportEdit";
import { reopenPhoneReport, rejectPhoneReport } from "@/lib/attendance/phoneReportActions";
import { scheduleDeferredDelete } from "@/lib/undo-engine";
import { WORK_SESSION_BUSINESS_DOMAINS } from "@/lib/expenses";
import { formatCurrency, formatMinutes, minutesBetween } from "@/lib/payroll";
import { formatShortDate, hebrewWeekday } from "@/lib/date";
import { toHebrewError } from "@/lib/error-messages";
import { cn } from "@/lib/utils";
import { withViewTransition } from "@/lib/ui/view-transition";
import type { PendingPhoneReport } from "@/lib/attendance/phone-reports";
import { attendanceSourceLabel } from "@/lib/attendance/my-shift";
import type { SalaryCenterProjectOption } from "@/lib/payroll-center";

/**
 * ONE waiting shift report, with everything needed to act on it: classify into a
 * business domain (optionally split across several), approve into a real paid
 * session, or reject.
 *
 * Lives in its own module because it's rendered from two places — the full queue
 * page (/payroll/attendance) and the dashboard's "נוכחות עובדים" card, which the
 * user asked to make actionable in place rather than a link to the page. Two
 * copies of an approve form would drift, and this one carries real payroll rules
 * (split minutes, billable amounts).
 */

/**
 * WHAT WAS DONE first, then how the report got here — the note the worker (or
 * whoever closed the shift) actually wrote leads, and the origin tag and "נרשם
 * ע״י" follow (user, 2026-08-18: "I need the comment before how it was added,
 * it's more important"). The line is truncated on the dashboard, so whatever
 * comes first is what survives; a shift described as "בנה סוכה וקפל ציוד" is
 * worth more there than the fact that it arrived by phone.
 *
 * Each part only when it adds something. "נרשם ע״י" still matters before
 * approving — it's the difference between a worker reporting his own hours and a
 * colleague reporting them for him — so it keeps its place, just after the note.
 */
/**
 * The ONE line a row shows about the shift itself: what was written about it, or
 * — when nobody wrote anything — how it got here. Always non-empty, so every row
 * is the same height, and never a run-on of three facts joined by dots.
 */
export function attendanceDetail(source: string, notes: string | null) {
  return freeTextNote(source, notes) || attendanceSourceLabel(source);
}

export function attendanceMeta(source: string, notes: string | null, reportedByName?: string | null) {
  const parts: string[] = [];
  const written = freeTextNote(source, notes);
  if (written) parts.push(written);
  parts.push(attendanceSourceLabel(source));
  if (reportedByName) parts.push(`נרשם ע״י ${reportedByName}`);
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

/** Card head shared by both rows: name, phone. */
export function WorkerHead({
  name,
  phone,
  clockIn,
  clockOut,
  duration,
  meta,
  metaTitle,
  chips,
  cost,
}: {
  name: string | null;
  phone: string | null;
  clockIn: string;
  /** Null while the shift is still open. */
  clockOut?: string | null;
  /** "3:01 שעות" / "כבר 3:01 שעות" for an open shift. */
  duration: string;
  /** The visible one-liner about the shift — see attendanceDetail. */
  meta: string;
  /** The full story behind it (origin, who filed it), for the tooltip. */
  metaTitle?: string;
  /** A status pill on the name line — e.g. "נוכח" for an open shift. */
  chips?: ReactNode;
  /** Far end of the row — the shift's labor cost (admin only). */
  cost?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  // Only offer the chevron when the full story says more than the visible line.
  const hasMore = Boolean(metaTitle && metaTitle !== meta);

  return (
    // Same shape as a delivery / task row: an identity line, then one muted line
    // of everything else. It used to be a bordered person-chip with a date badge
    // in the opposite corner — two boxes inside a box, which read as a card in a
    // card once these rows moved onto the dashboard. No avatar (user, 2026-08-31):
    // the name + phone already identify the worker, so the circle was a second,
    // redundant identity mark eating width the dropdowns needed.
    <div className="flex items-start gap-2.5">
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="truncate text-sm font-medium text-foreground">{name ?? "עובד לא ידוע"}</span>
          {phone ? (
            <span className="shrink-0 text-xs text-muted-foreground" dir="ltr">
              {phone}
            </span>
          ) : null}
          {/* The shift's numbers own the opposite corner, STACKED: how long on
              top, from-when-to-when under it. Side by side they read as one long
              string of digits. */}
          <span className="ms-auto shrink-0 text-end leading-tight">
            <span className="block text-xs font-semibold tabular-nums text-foreground">{duration}</span>
            <span className="block text-[11px] tabular-nums text-muted-foreground">
              {shiftHoursText(clockIn, clockOut)}
            </span>
          </span>
          {chips ? <span className="flex shrink-0 items-center gap-1.5">{chips}</span> : null}
        </div>

        {/* WHAT WAS DONE, on a line of its own — the note alone rather than three
            facts run together with dots, so it never competes with the numbers.
            Truncated, with a chevron when there's more behind it (the origin, who
            filed it): a tooltip can't be read on a phone, and sending someone to
            another page to learn who filed a report is a heavy answer to a small
            question. */}
        {meta ? (
          hasMore ? (
            // The WHOLE line is the toggle, not just the chevron. A 14px glyph
            // sitting on top of a row-wide link is a target you miss, and missing
            // it navigates to the queue page — which is exactly what you didn't
            // want when you were reaching for "who filed this". `relative` lifts
            // the button over that link (positioned, and later in the DOM).
            <button
              type="button"
              onClick={() => withViewTransition(() => setExpanded((v) => !v))}
              aria-expanded={expanded}
              aria-label={expanded ? "הסתרת פרטי הדיווח" : "פרטי הדיווח — מקור ומי רשם"}
              className="relative flex w-full items-center gap-1 text-start text-xs text-foreground/80"
            >
              <span className={cn("min-w-0", expanded ? "break-words" : "truncate")}>
                {expanded ? metaTitle ?? meta : meta}
              </span>
              <ChevronDownIcon
                className={cn(
                  "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                  expanded ? "rotate-0" : "rotate-90"
                )}
              />
            </button>
          ) : (
            <div className="truncate text-xs text-foreground/80">{meta}</div>
          )
        ) : null}
      </div>
      {cost ? <div className="shrink-0">{cost}</div> : null}
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

export default function PendingReportCard({
  report,
  projectOptions,
  propertyOptions,
  canReopen = false,
  flat = false,
  href,
}: {
  report: PendingPhoneReport;
  projectOptions: SalaryCenterProjectOption[];
  propertyOptions: SalaryCenterProjectOption[];
  /** Offer to put the worker back on the clock from this shift's clock-out. */
  canReopen?: boolean;
  /**
   * Drop the card chrome. On its own page each report IS a card; inside the
   * dashboard's queue card it would be a card in a card — a second frame that
   * carries no information. The parent separates the rows instead.
   */
  flat?: boolean;
  /**
   * Where the row leads when you click it rather than one of its controls — the
   * queue page, opened at this report. Only the dashboard passes it: on the page
   * itself the row IS the destination.
   */
  href?: string;
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
  // Fixing the report's OWN clock in/out/note before it's even classified —
  // separate from approving. Same hook + form the worker uses to edit his own
  // pending report (components/attendance/PendingReportList.tsx), pointed at the
  // admin route instead, which isn't held to the worker self-report backdate limit.
  const timeEdit = usePendingReportEdit(report, "admin");

  const totalMinutes = report.worked_minutes ?? minutesBetween(report.clock_in, report.clock_out);
  const split = parts.length > 1;
  // Every part needs a domain before this can go anywhere. The deeper rules
  // (a project for project work, a valid split, a billable amount) stay in
  // approve() — they're conditional, and a button that goes dead for a reason
  // you can't see is worse than a message.
  const canApprove = parts.every((p) => Boolean(p.domain));
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
   *  rather than starting a second one that would be approved separately. Deferred
   *  like a delete-from-this-queue: the report leaves the pending list right away
   *  and only actually flips back to "open" once the window elapses unopposed. */
  function reopen() {
    setError("");
    const reportId = report.id;
    scheduleDeferredDelete({
      scope: "phone-report-pending",
      id: reportId,
      message: "המשמרת נפתחה מחדש והעובד חזר לנוכחים.",
      onCommit: async () => {
        const result = await reopenPhoneReport(reportId);
        if (!result.ok) return { ok: false, error: toHebrewError(result.error, "פתיחת המשמרת מחדש נכשלה.") };
        router.refresh();
        return { ok: true };
      },
    });
  }

  function reject() {
    setError("");
    const reportId = report.id;
    const reasonSnapshot = rejectReason.trim();
    setRejectOpen(false);
    scheduleDeferredDelete({
      scope: "phone-report-pending",
      id: reportId,
      message: "הדיווח נדחה.",
      onCommit: async () => {
        const result = await rejectPhoneReport(reportId, reasonSnapshot);
        if (!result.ok) return { ok: false, error: toHebrewError(result.error, "דחיית הדיווח נכשלה.") };
        router.refresh();
        return { ok: true };
      },
    });
  }

  const partFields = (index: number) => (
    <>
      <DomainSelect
        value={parts[index].domain}
        onChange={(next) => updatePart(index, { domain: next, projectId: "", propertyId: "", billable: false, billAmount: "" })}
        domains={WORK_SESSION_BUSINESS_DOMAINS}
        // "שיוך", not "בחירת תחום": the select shares its row with the buttons in
        // a quarter-width card, and the longer placeholder only ever rendered as
        // "בחירת ...". The full name stays in the aria-label.
        placeholder="שיוך"
        ariaLabel="תחום עסקי"
        className="h-9 w-full min-w-[8.5rem] max-w-40 px-3 py-0"
      />
      {parts[index].domain === "logistics_projects" ? (
        <SearchableSelect
          options={projectSelectOptions}
          value={parts[index].projectId}
          onChange={(v) => updatePart(index, { projectId: v })}
          placeholder="בחירת פרויקט"
          ariaLabel="פרויקט"
          className="h-9 w-full min-w-[10rem] max-w-48 px-3 py-0"
        />
      ) : null}
      {parts[index].domain === "property_management" ? (
        <SearchableSelect
          options={propertySelectOptions}
          value={parts[index].propertyId}
          onChange={(v) => updatePart(index, { propertyId: v })}
          placeholder="בחירת נכס"
          ariaLabel="נכס"
          className="h-9 w-full min-w-[10rem] max-w-48 px-3 py-0"
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
            className="w-full min-w-[9.5rem] max-w-40"
          >
            <option value="no">ללא חיוב ללקוח</option>
            <option value="yes">חיוב ללקוח</option>
          </NativeSelect>
          {parts[index].billable ? (
            <CurrencyInput
              value={parts[index].billAmount}
              onChange={(e) => updatePart(index, { billAmount: e.target.value })}
              placeholder="סכום לחיוב"
              containerClassName="w-full min-w-[6rem] max-w-32"
            />
          ) : null}
        </>
      ) : null}
    </>
  );

  return (
    <div
      data-focus-id={report.id}
      className={cn(
        flat
          ? // The same blue row-hover the other board cards use, so pointing at a
            // report picks out THAT one — without it a stack of near-identical
            // forms gives you nothing to hold on to.
            "relative px-4 py-3 transition-colors hover:bg-secondary/10"
          : // border-2, not the usual border-1: on the queue page each report is
            // its own shift, and a hairline the same weight as every other card
            // border in the app read as one continuous strip rather than
            // separate stops (user, 2026-08-31: wants a clear break between them).
            "rounded-xl border-2 border-border bg-card px-3 py-2 shadow-sm"
      )}
    >
      {/* Covers the row, under everything you can actually act on: the head below
          is unpositioned so this link paints over it, while the classify row is
          `relative` and keeps its own clicks. Same pattern as a delivery row —
          a <button> inside an <a> wouldn't be legal HTML. */}
      {href ? (
        <Link
          href={href}
          aria-label={`דיווח הנוכחות של ${report.worker_name ?? "עובד"}`}
          className="absolute inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      ) : null}
      {/* Who / when / how it got here — the WHEN block is the same shift row the
          worker card shows, so one shift reads identically on both screens. */}
      <WorkerHead
        name={report.worker_name}
        phone={report.worker_phone}
        clockIn={report.clock_in}
        clockOut={report.clock_out}
        duration={`${formatMinutes(totalMinutes)} שעות`}
        // This queue is admin/office-only (see the page-level role gate), who
        // never read Arabic — prefer the Hebrew translation when one exists.
        meta={attendanceDetail(report.source, report.notes_he ?? report.notes)}
        metaTitle={attendanceMeta(report.source, report.notes_he ?? report.notes, report.reported_by_name)}
        // The date, only where the list ISN'T grouped by day: on the dashboard a
        // heading above each group already says it.
        chips={
          flat ? null : (
            <span className="text-xs text-muted-foreground">
              {hebrewWeekday(report.clock_in)} {formatShortDate(report.clock_in)}
            </span>
          )
        }
        cost={
          report.labor_cost != null ? (
            <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-sm font-semibold text-foreground">
              {formatCurrency(report.labor_cost)}
            </span>
          ) : null
        }
      />

      {/* Row 2 — classify, then act, each on its OWN row. The fields used to
          share one row with the buttons and get squeezed down to a sliver
          ("min-w-0" let flexbox shrink a chosen domain to a couple of
          letters) — now the fields get the card's full width and wrap onto
          as many lines as they need (user, 2026-08-31: dropdowns were
          unreadably cut off; let them take a row if necessary). Splitting is
          the exception and gets its own block below. No rule above it when
          `flat`: the parent already draws one BETWEEN reports, and a second
          one inside each was a line where the eye expected a boundary. */}
      <div className={cn("relative mt-2", !flat && "border-t border-border/60 pt-2")}>
        <div className="flex flex-wrap items-center gap-2">
          {split ? <span className="text-sm text-muted-foreground">מפוצל ל-{parts.length} תחומים</span> : partFields(0)}
        </div>
        <div className="mt-2 flex items-center justify-end gap-1">
          {/* The secondary actions are BARE GLYPHS — no plate, no border, no word
              (user, 2026-08-17: "just an outline icon like the share button").
              Approving is the act you came for and keeps the filled button; these
              sit beside it without competing. aria-label/title carry the Hebrew
              name, which is the whole reason an icon-only control is allowed. */}
          <Button
            type="button"
            variant="ghost"
            className="h-8 w-8 shrink-0 p-0 shadow-none max-md:min-h-[44px] max-md:min-w-[44px]"
            onClick={timeEdit.editing ? timeEdit.closeEditor : timeEdit.openEditor}
            disabled={isPending}
            aria-label="עריכת שעות הדיווח"
            title="עריכת שעות הדיווח"
          >
            <EditIcon className="h-4 w-4" />
          </Button>
          {canSplit ? (
            // The icon is Layers (one shift becoming several stacked parts); the
            // Split glyph read as a road fork.
            <Button
              type="button"
              variant="ghost"
              className="h-8 w-8 shrink-0 p-0 shadow-none max-md:min-h-[44px] max-md:min-w-[44px]"
              onClick={addPart}
              aria-label={split ? "הוסף תחום" : "פיצול לתחומים"}
              title={split ? "הוסף תחום" : "פיצול לתחומים"}
            >
              {split ? <AddIcon className="h-4 w-4" /> : <LayersIcon className="h-4 w-4" />}
            </Button>
          ) : null}
          {canReopen ? (
            <Button
              type="button"
              variant="ghost"
              className="h-8 w-8 shrink-0 p-0 shadow-none max-md:min-h-[44px] max-md:min-w-[44px]"
              onClick={reopen}
              disabled={isPending}
              aria-label="החזרה למשמרת פתוחה — העובד ממשיך לעבוד"
              title="החזרה למשמרת פתוחה — העובד ממשיך לעבוד"
            >
              <RefreshIcon className="h-4 w-4" />
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            className="h-8 w-8 shrink-0 p-0 text-destructive shadow-none hover:bg-destructive/10 hover:text-destructive max-md:min-h-[44px] max-md:min-w-[44px]"
            onClick={() => setRejectOpen(true)}
            disabled={isPending}
            aria-label="דחיית הדיווח"
            title="דחיית הדיווח"
          >
            <BlockedIcon className="h-4 w-4" />
          </Button>
          {/* The word alone, same size and shape as "סופק" / "בוצע" on the other
              board cards. OUTLINE while it's still dead weight — a filled button
              per row, repeated down four cards, turned the board into a column
              of blue blocks that shouted over the rows themselves (user,
              2026-08-18) — but it FILLS the moment a שיוך makes it clickable, so
              the one button actually worth pressing now stands out (user,
              2026-08-31: wants it obvious once ready). */}
          <Button
            type="button"
            size="sm"
            variant={canApprove ? "default" : "outline"}
            className="h-8 shrink-0 px-3 text-sm max-md:min-h-[44px]"
            onClick={approve}
            // Dead until a שיוך is chosen. Approving without one was the ONE
            // error anybody hit, and its message appeared under the row — which
            // grew the row, shifted every row below it, and told you something
            // the disabled button now says without moving anything.
            disabled={isPending || !canApprove}
            title={canApprove ? "אישור הדיווח" : "בחרו שיוך כדי לאשר"}
          >
            {isPending ? "..." : "אישור"}
          </Button>
        </div>
      </div>

      {timeEdit.editing ? (
        <div className={cn("relative mt-2", !flat && "border-t border-border/60 pt-2")}>
          <PendingReportEditFields state={timeEdit} />
        </div>
      ) : null}

      {split ? (
        <div className="relative mt-2 space-y-2">
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
        <div className="relative">
          <Textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="סיבת הדחייה"
            rows={2}
            className="pe-11"
          />
          <DictateButton
            onTranscript={(text) => setRejectReason((prev) => appendDictatedText(prev, text))}
            className="absolute bottom-1 end-1 h-8 w-8"
          />
        </div>
      </ConfirmDialog>
    </div>
  );
}

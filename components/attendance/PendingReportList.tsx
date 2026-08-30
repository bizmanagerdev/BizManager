"use client";

import { useState } from "react";
import { EditIcon } from "@/components/ui/icons";
import { SwipeActions } from "@/components/ui/swipe-actions";
import { EditButton } from "@/components/ui/icon-button";
import { formatMinutes } from "@/lib/payroll";
import { DayTile, shiftHoursText } from "@/components/attendance/DayTile";
import { PendingReportEditFields, usePendingReportEdit } from "@/components/attendance/usePendingReportEdit";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/types";
import { profileDict } from "@/lib/i18n/dictionaries/profile";
import type { MyShiftReport } from "@/lib/attendance/my-shift";

/**
 * The pending-approval rows on the worker's own profile — same day-tile +
 * "11:15 עד 01:00" layout as the approved SessionList (DayTile/shiftHoursText
 * are shared for exactly that reason), so a shift looks the same whether it's
 * waiting for the boss or already through. Editable here too: nothing has
 * reached payroll yet, so it's a plain in-place edit rather than the approved
 * list's withdraw-and-requeue correction.
 */
export function PendingReportList({ reports, locale = "he" }: { reports: MyShiftReport[]; locale?: Locale }) {
  return (
    <div data-swipe-owner="" className="-mx-3 divide-y divide-border/60 sm:mx-0">
      {reports.map((report) => (
        <PendingReportRow key={report.id} report={report} locale={locale} />
      ))}
    </div>
  );
}

function PendingReportRow({ report, locale }: { report: MyShiftReport; locale: Locale }) {
  const edit = usePendingReportEdit(report);
  const [swipeOpen, setSwipeOpen] = useState(false);

  const row = (
    <div className="bg-card px-3 py-2 text-right text-xs sm:px-0">
      <div className="grid grid-cols-[2.75rem_6.5rem_1fr] items-start gap-2">
        <DayTile clockIn={report.clock_in} clockOut={report.clock_out} />
        <div className="tabular-nums">
          <div className="font-semibold">
            {report.worked_minutes ? `${formatMinutes(report.worked_minutes)} ${t(profileDict, locale, "hoursSuffix")}` : ""}
          </div>
          <div className="text-muted-foreground">{shiftHoursText(report.clock_in, report.clock_out)}</div>
        </div>
        <div className="min-w-0">{report.notes ? <div className="break-words text-muted-foreground">{report.notes}</div> : null}</div>
      </div>
      {edit.editing ? (
        <div className="mt-2 border-t border-border/60 pt-2">
          <PendingReportEditFields state={edit} />
        </div>
      ) : null}
    </div>
  );

  if (edit.editing) return row;

  return (
    <>
      {/* Phone: swipe to reveal the pencil, same gesture as the approved list. */}
      <div className="sm:hidden">
        <SwipeActions
          className="rounded-none"
          open={swipeOpen}
          onOpenChange={setSwipeOpen}
          actions={[
            {
              key: "edit",
              label: t(profileDict, locale, "editActionLabel"),
              icon: <EditIcon className="h-5 w-5" />,
              className: "bg-secondary",
              onSelect: () => {
                setSwipeOpen(false);
                edit.openEditor();
              },
            },
          ]}
        >
          {row}
        </SwipeActions>
      </div>
      {/* Desktop: the pencil sits beside the row, no swipe to discover. */}
      <div className="hidden items-start justify-between gap-2 sm:flex">
        {row}
        <EditButton onClick={edit.openEditor} disabled={edit.working} className="mt-2" />
      </div>
    </>
  );
}

export default PendingReportList;

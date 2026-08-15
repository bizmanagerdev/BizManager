"use client";

import { useState } from "react";
import { DeleteIcon, EditIcon } from "@/components/ui/icons";
import { SwipeActions } from "@/components/ui/swipe-actions";
import { Badge } from "@/components/ui/badge";
import { DeleteButton, EditButton } from "@/components/ui/icon-button";
import { EmptyState } from "@/components/ui/empty-state";
import { formatMinutes, sessionWorkedMinutes, type WorkSessionRow } from "@/lib/payroll";
import { getBusinessDomainLabel } from "@/lib/expenses";
import { DayTile, shiftHoursText } from "@/components/attendance/DayTile";
import { SessionEditFields, useSessionEdit } from "@/components/attendance/useSessionEdit";

const PAY_STATUS_META: Record<string, { label: string; variant: "success" | "warning" | "destructive" | "neutral" }> = {
  paid: { label: "שולם", variant: "success" },
  partial: { label: "שולם חלקית", variant: "warning" },
  unpaid: { label: "לא שולם", variant: "destructive" },
  pending: { label: "טרם הגיע מועד", variant: "neutral" },
  overpaid: { label: "שולם ביתר", variant: "neutral" },
};

export type SessionListItem = {
  session: WorkSessionRow;
  /** From worker_debt_items_view; omitted when the viewer may not see pay. */
  paymentStatus?: string;
  /** The specific project name / property address the shift was booked to. */
  linkLabel?: string;
};

/** Whose job was it — the specific project/address, else the domain. */
function whatFor(item: SessionListItem) {
  return item.linkLabel || getBusinessDomainLabel(item.session.business_domain);
}

/**
 * The day tile and the "עד" hours range live in components/attendance/DayTile.tsx
 * — the approval queue shows the same shift rows, and one shift must look the
 * same wherever you meet it.
 */
function shiftHours(session: WorkSessionRow) {
  return shiftHoursText(session.clock_in, session.clock_out);
}

/**
 * Staff edit a session directly (it's their payroll to fix), so they get their
 * own handlers rather than the worker's withdraw-and-requeue correction.
 */
export type StaffSessionActions = {
  onEdit: (session: WorkSessionRow) => void;
  onDelete: (session: WorkSessionRow) => void;
  disabled?: boolean;
};

export default function SessionList({
  items,
  showTiming = true,
  canEdit = false,
  staffActions,
}: {
  items: SessionListItem[];
  /** Session-only ("קבלנות") workers are paid per shift, not per hour. */
  showTiming?: boolean;
  /** Worker correction flow: swipe on touch, pencil on desktop. */
  canEdit?: boolean;
  staffActions?: StaffSessionActions;
}) {
  if (items.length === 0) return <EmptyState dense>אין עדיין משמרות בחודש הזה.</EmptyState>;

  const hasActions = canEdit || Boolean(staffActions);

  return (
    <>
      {/* Phone: three columns and nothing else. Payment and the edit button
          don't get columns of their own — payment rides under the name, and edit
          is the swipe, which is why the row can't be a <tr>.
          Alignment comes from every row sharing the SAME explicit grid template
          (not `auto` tracks, which size per row — that's what made the earlier
          card layout ragged). */}
      {/* data-swipe-owner on the WHOLE list, not just each swipeable row: the
          gaps matter. Once a row's editor is open its swipe wrapper is gone, and
          a drag that lands between rows never touches one either — both cases
          fell through to the page's tab-paging gesture and flicked you to the
          next tab. Nothing in this list should ever change tab. */}
      <div
        data-swipe-owner=""
        className="-mx-3 divide-y divide-border/60 border-y border-border/60 md:hidden"
      >
        {items.map((item) => (
          <SessionSwipeRow
            key={item.session.id}
            item={item}
            showTiming={showTiming}
            canEdit={canEdit}
            staffActions={staffActions}
          />
        ))}
      </div>

      {/* Desktop: a real table, where there's width for payment and the actions
          as columns of their own. */}
      <div data-swipe-owner="" className="hidden md:block">
      <table className="w-full min-w-full text-right text-xs sm:text-sm">
        <thead>
          <tr className="border-y border-border/60 text-[0.6875rem] text-muted-foreground">
            <th className="px-2 py-1.5 font-medium md:px-3">תאריך</th>
            {/* Duration and the hours it ran between are ONE column, stacked —
                two facts about the same span of time, and keeping them together
                leaves שיוך as the third column rather than the fourth. */}
            {showTiming ? <th className="px-1 py-1.5 font-medium md:px-3">שעות</th> : null}
            {/* w-full: this column absorbs the leftover width, so a long project
                name wraps here rather than squeezing the numeric columns. */}
            <th className="w-full px-2 py-1.5 font-medium md:px-3">שיוך</th>
            <th className="px-1 py-1.5 font-medium md:px-3">תשלום</th>
            {hasActions ? <th className="px-1 py-1.5 md:px-3" /> : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {items.map((item) => (
            <SessionTableRow
              key={item.session.id}
              item={item}
              showTiming={showTiming}
              canEdit={canEdit}
              staffActions={staffActions}
            />
          ))}
        </tbody>
      </table>
      </div>
    </>
  );
}

/**
 * One shift on a phone: day tile · duration over hours · what it was for.
 * Swipe it to correct it — that's why this is a div grid and not a table row.
 */
function SessionSwipeRow({
  item,
  showTiming,
  canEdit,
  staffActions,
}: {
  item: SessionListItem;
  showTiming: boolean;
  canEdit: boolean;
  staffActions?: StaffSessionActions;
}) {
  const { session } = item;
  const edit = useSessionEdit(session);
  const [swipeOpen, setSwipeOpen] = useState(false);
  const payMeta = item.paymentStatus ? PAY_STATUS_META[item.paymentStatus] : undefined;
  const editable = isEditable(item, canEdit);

  const row = (
    <div className="bg-card px-3 py-2 text-right text-xs">
      <div
        className={
          showTiming
            ? "grid grid-cols-[2.75rem_6.5rem_1fr] items-start gap-2"
            : "grid grid-cols-[2.75rem_1fr] items-start gap-2"
        }
      >
        <DayTile clockIn={session.clock_in} clockOut={session.clock_out} />
        {showTiming ? (
          <div className="tabular-nums">
            <div className="font-semibold">{formatMinutes(sessionWorkedMinutes(session))} שעות</div>
            <div className="text-muted-foreground">{shiftHours(session)}</div>
          </div>
        ) : null}
        <div className="min-w-0">
          <div className="break-words">{whatFor(item)}</div>
          {payMeta ? (
            <Badge variant={payMeta.variant} className="mt-1">
              {payMeta.label}
            </Badge>
          ) : null}
          {session.notes ? <div className="mt-0.5 text-muted-foreground">{session.notes}</div> : null}
        </div>
      </div>
      {edit.editing ? (
        <div className="mt-2 border-t border-border/60 pt-2">
          <SessionEditFields state={edit} />
        </div>
      ) : null}
    </div>
  );

  const actions = staffActions
    ? [
        {
          key: "edit",
          label: "עריכה",
          icon: <EditIcon className="h-5 w-5" />,
          className: "bg-secondary",
          onSelect: () => {
            setSwipeOpen(false);
            staffActions.onEdit(session);
          },
        },
        {
          key: "delete",
          label: "מחיקה",
          icon: <DeleteIcon className="h-5 w-5" />,
          className: "bg-destructive",
          onSelect: () => {
            setSwipeOpen(false);
            staffActions.onDelete(session);
          },
        },
      ]
    : editable
      ? [
          {
            key: "edit",
            label: "תיקון",
            icon: <EditIcon className="h-5 w-5" />,
            className: "bg-secondary",
            onSelect: () => {
              setSwipeOpen(false);
              edit.openEditor();
            },
          },
        ]
      : [];

  // Nothing to reveal → a plain row rather than a swipe strip over empty space.
  if (actions.length === 0 || edit.editing) return row;

  // rounded-none: a rounded corner mid-list would break the run of rules.
  return (
    <SwipeActions className="rounded-none" open={swipeOpen} onOpenChange={setSwipeOpen} actions={actions}>
      {row}
    </SwipeActions>
  );
}

/** Can this shift still be pulled back out of payroll? Paid money can't. */
function isEditable(item: SessionListItem, canEdit: boolean) {
  return canEdit && item.paymentStatus !== "paid" && item.paymentStatus !== "overpaid";
}

function SessionTableRow({
  item,
  showTiming,
  canEdit,
  staffActions,
}: {
  item: SessionListItem;
  showTiming: boolean;
  canEdit: boolean;
  staffActions?: StaffSessionActions;
}) {
  const { session } = item;
  const edit = useSessionEdit(session);
  const payMeta = item.paymentStatus ? PAY_STATUS_META[item.paymentStatus] : undefined;
  const editable = isEditable(item, canEdit);
  const hasActions = canEdit || Boolean(staffActions);
  // date + שיוך + payment, plus the (merged) timing column and the action column
  // when they're rendered — the editor row spans all of them.
  const columnCount = 3 + (showTiming ? 1 : 0) + (hasActions ? 1 : 0);

  return (
    <>
      <tr className="align-top">
        <td className="whitespace-nowrap px-2 py-2 md:px-3">
          <DayTile clockIn={session.clock_in} clockOut={session.clock_out} />
        </td>
        {showTiming ? (
          <td className="whitespace-nowrap px-1 py-2 tabular-nums md:px-3">
            <div className="font-semibold">{formatMinutes(sessionWorkedMinutes(session))} שעות</div>
            <div className="text-muted-foreground">{shiftHours(session)}</div>
          </td>
        ) : null}
        <td className="px-2 py-2 md:px-3">
          <div className="break-words">{whatFor(item)}</div>
          {session.notes ? <div className="text-xs text-muted-foreground">{session.notes}</div> : null}
        </td>
        <td className="px-1 py-2 md:px-3">
          {payMeta ? <Badge variant={payMeta.variant}>{payMeta.label}</Badge> : null}
        </td>
        {hasActions ? (
          <td className="px-1 py-2 md:px-3">
            <div className="flex items-center justify-end gap-1">
              {staffActions ? (
                <>
                  <EditButton onClick={() => staffActions.onEdit(session)} disabled={staffActions.disabled} />
                  <DeleteButton
                    onClick={() => staffActions.onDelete(session)}
                    disabled={staffActions.disabled}
                  />
                </>
              ) : editable && !edit.editing ? (
                <EditButton label="תיקון" onClick={edit.openEditor} disabled={edit.working} />
              ) : null}
            </div>
          </td>
        ) : null}
      </tr>
      {edit.editing ? (
        <tr>
          <td colSpan={columnCount} className="px-2 pb-3 md:px-3">
            <SessionEditFields state={edit} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

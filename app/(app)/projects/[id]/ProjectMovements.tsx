"use client";

// One ledger for the project's money: every payment in, every expense and wage
// out, newest first. It replaces the הוצאות / הכנסות / לחיוב לקוח / תזרים
// quartet, where each row appeared twice. Totals aren't repeated here — סיכום
// כספי is the summary; this footer is what PROVES the summary against the
// actual rows (see the totals block at the bottom of this file).
//
// A row shows the things you scan for: date, category + name, status,
// billed-to-customer, and how much — split into separate IN/OUT columns so
// either can be scanned without reading a sign. Everything else — notes,
// method, reference, session hours, who recorded it, attachments — waits
// behind the row's chevron, so the common case stays one line.
//
// קיבוץ (groupBy) reshapes the SAME rows into one collapsed group per
// employee/category/date (subtotal up front, rows behind its own chevron) —
// a long project's rows are a "who/what/when adds up to how much" question far
// more often than a chronological one. Rows with no bucket for the current
// groupBy (e.g. a payment has no employee) fall through to an ungrouped list
// underneath, still in the normal sorted order. מיון (sortBy/sortDirection)
// governs that order; groupBy and sortBy/sortDirection are both controlled by
// the section header's own "תצוגה" dropdown (ProjectTabsClient.tsx), which
// also owns persisting the choice — this component only renders it.

import { Fragment, useMemo, useState } from "react";
import {
  AttachIcon,
  CheckIcon,
  ChevronDownIcon,
  DeleteIcon,
  EditIcon,
  MoreIcon,
  SpinnerIcon,
} from "@/components/ui/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import { SwipeActions } from "@/components/ui/swipe-actions";
import { getStatusColor, getStatusLabel, type StatusColor } from "@/lib/ui/status-colors";
import type { FinancialAttachment } from "@/lib/payments";
import type { LedgerGroupBy, LedgerSortBy, LedgerSortDirection } from "@/lib/projectLedgerPrefs";
import { formatIls, formatDate, LtrInline } from "./ProjectTabsClient.helpers";

export type Movement = {
  key: string;
  direction: "in" | "out";
  date: string | null;
  /** The kind chip ("שכר עובד", an expense category…) — null when there's
   *  nothing worth a chip (a payment). */
  category: string | null;
  /** The specific name/description — who or what this movement is. */
  name: string;
  /** Payment-status value for StatusBadge; null for rows that have no status. */
  status: string | null;
  /** Only meaningful when status is "not_due" — StatusBadge shows it as
   *  "צפוי <date>" instead of the bare fallback. */
  dueDate?: string | null;
  /** Re-charged to the customer — shown as a small subordinate mark, never a
   *  same-weight badge next to payment status (see BilledMark below). */
  billed: boolean;
  /** What's actually billed to the customer — null unless `billed`. Can
   *  differ from `amount` (a worker session billed at a markup); for a
   *  pass-through expense it's the same figure as `amount`. */
  billedAmount: number | null;
  amount: number | null;
  /** Stable id + display name for "קיבוץ לפי עובד" — set on worker-cost rows
   *  (sessions, monthly salary). Null puts the row in the ungrouped bucket
   *  (payments, non-worker expenses have no single employee). */
  employeeId?: string | null;
  employeeName?: string | null;
  /** One-line hint shown under the name (notes, method, period…). */
  hint: string | null;
  /** Label/value pairs shown when the row is opened. */
  extras: { label: string; value: string }[];
  attachments: FinancialAttachment[];
  busy?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
};

/** Pill when there's room; at a narrow container (a phone, or any width once
 *  large-text mode eats into it — em-based container queries make those the
 *  same signal) the pill shell drops and it's plain coloured text on its own
 *  line instead, so the category word can never wrap mid-pill. */
function CategoryChip({ label }: { label: string }) {
  return (
    <span
      className={cn(
        "block text-[0.8125rem] font-medium text-secondary",
        "@[24em]:inline-flex @[24em]:items-center @[24em]:rounded-full @[24em]:border @[24em]:border-border",
        "@[24em]:bg-muted @[24em]:px-1.5 @[24em]:py-0 @[24em]:text-[0.6875rem] @[24em]:text-muted-foreground"
      )}
    >
      {label}
    </span>
  );
}

/** Billed-to-customer, deliberately subordinate to payment status: an icon +
 *  a short word (+ the amount) in the app's blue, no badge shell — used
 *  wherever there's no dedicated column to lean on (mobile row). */
function BilledMark({ amount, className }: { amount: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 text-secondary", className)}>
      <CheckIcon className="h-3 w-3" />
      <span className="whitespace-nowrap text-[0.6875rem] font-medium">
        לחיוב לקוח <LtrInline>{formatIls(amount)}</LtrInline>
      </span>
    </span>
  );
}

/** Desktop's own narrow column for the same mark — the header already says
 *  what it is, so the cell is just the amount (or nothing). */
function BilledCell({ amount }: { amount: number | null }) {
  if (amount === null) return <span className="text-muted-foreground/40">—</span>;
  return (
    <span className="whitespace-nowrap text-secondary">
      <LtrInline>{formatIls(amount)}</LtrInline>
    </span>
  );
}

/** One side of the split amount — IN and OUT each get their own column so
 *  either can be scanned without reading a sign; the empty side is a quiet
 *  dash, not a shout. */
function AmountCell({ movement, side }: { movement: Movement; side: "in" | "out" }) {
  if (movement.amount === null || movement.direction !== side) {
    return <span className="text-muted-foreground/40">—</span>;
  }
  return (
    <span className={cn("whitespace-nowrap", side === "in" ? "text-success" : "text-destructive")}>
      <LtrInline>{formatIls(Math.abs(movement.amount))}</LtrInline>
    </span>
  );
}

function Attachments({ attachments }: { attachments: FinancialAttachment[] }) {
  const withUrl = attachments.filter((attachment) => attachment.url);
  if (withUrl.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {withUrl.map((attachment, index) => (
        <a
          key={attachment.document_id}
          href={attachment.url ?? "#"}
          target="_blank"
          rel="noreferrer"
          title={attachment.file_name ?? "קובץ"}
          className="inline-flex items-center gap-1 rounded-md border border-border/60 px-1.5 py-0.5 text-[0.6875rem] text-secondary hover:bg-accent"
        >
          <AttachIcon className="h-3 w-3" />
          {withUrl.length > 1 ? `קובץ ${index + 1}` : "קובץ"}
        </a>
      ))}
    </div>
  );
}

function RowActions({ movement }: { movement: Movement }) {
  if (!movement.onEdit && !movement.onDelete) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={movement.busy}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 w-8 shrink-0 p-0 text-muted-foreground hover:text-foreground"
          title="פעולות"
          aria-label="פעולות"
        >
          {movement.busy ? (
            <SpinnerIcon className="h-4 w-4 animate-spin" />
          ) : (
            <MoreIcon className="h-4 w-4" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        {movement.onEdit ? (
          <DropdownMenuItem onClick={movement.onEdit}>
            <EditIcon className="me-2 h-4 w-4" />
            עריכה
          </DropdownMenuItem>
        ) : null}
        {movement.onDelete ? (
          <DropdownMenuItem
            onClick={movement.onDelete}
            className="text-destructive focus:text-destructive"
          >
            <DeleteIcon className="me-2 h-4 w-4" />
            מחיקה
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function hasAttachment(movement: Movement) {
  return movement.attachments.some((attachment) => attachment.url);
}

/** Some expenses have their category typed verbatim into the description too
 *  ("פועלים מזדמנים" as both) — showing it a second time as plain text right
 *  after its own chip is pure noise, worse on the phone's narrower line. */
function movementNameRepeatsCategory(movement: Movement) {
  return Boolean(
    movement.category && movement.category.trim().toLowerCase() === movement.name.trim().toLowerCase()
  );
}

function hasDetails(movement: Movement) {
  return movement.extras.length > 0 || hasAttachment(movement);
}

/** Inline hint that the row has a file — expand it to open the file itself.
 *  There's no dedicated "קובץ מצורף" column (an em-dash on every row without
 *  one, since attachments are rare). */
function AttachmentHint() {
  return <AttachIcon className="ms-1.5 inline h-3.5 w-3.5 shrink-0 align-text-bottom text-muted-foreground" />;
}

function Details({ movement }: { movement: Movement }) {
  const hasExtras = movement.extras.length > 0;
  const hasFiles = movement.attachments.some((attachment) => attachment.url);
  if (!hasExtras && !hasFiles) return null;
  return (
    <div className="space-y-2">
      {hasExtras ? (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
          {movement.extras.map((extra) => (
            <div key={extra.label} className="flex gap-1.5">
              <dt className="text-muted-foreground">{extra.label}:</dt>
              <dd className="min-w-0 font-medium">{extra.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {hasFiles ? <Attachments attachments={movement.attachments} /> : null}
    </div>
  );
}

const DOT_BY_COLOR: Record<StatusColor, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  info: "bg-info",
  neutral: "bg-muted-foreground/50",
};

function StatusDot({ status }: { status: string }) {
  const color = getStatusColor("payment", status);
  return (
    <span
      className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", DOT_BY_COLOR[color])}
      title={getStatusLabel("payment", status)}
      aria-label={getStatusLabel("payment", status)}
    />
  );
}

function ExpandedCard({ movement }: { movement: Movement }) {
  const recordedBy = movement.extras.find((extra) => extra.label === "נרשם")?.value ?? null;
  const facts = movement.extras.filter((extra) => extra.label !== "נרשם");
  const files = movement.attachments.filter((attachment) => attachment.url);

  return (
    <div className="mt-2 space-y-1.5 ps-6 text-xs">
      {/* Date leads: it's what the eye looks for first in a statement. Billed
          already showed once, inline with the title above (this card never
          hides that line) — repeating it here would be the same doubled
          badge this component exists to avoid. */}
      <div className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
        <LtrInline>{formatDate(movement.date)}</LtrInline>
        {movement.status ? (
          <StatusBadge value={movement.status} type="payment" dueDate={movement.dueDate} />
        ) : null}
      </div>

      {/* A real <dl>, not "label: value · label: value" joined by a middle
          dot — that join wraps mid-pair at large text and comes out as
          nonsense. Each fact gets its own row instead; it can only wrap
          within itself. */}
      {facts.length > 0 ? (
        <dl className="space-y-1">
          {facts.map((extra) => (
            <div key={extra.label} className="flex flex-wrap gap-x-1.5">
              <dt className="shrink-0 text-muted-foreground">{extra.label}:</dt>
              <dd className="min-w-0 font-medium text-foreground">{extra.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {recordedBy || files.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-muted-foreground">
          <span className="min-w-0">{recordedBy ?? ""}</span>
          {files.length > 0 ? <Attachments attachments={movement.attachments} /> : null}
        </div>
      ) : null}
    </div>
  );
}

type MovementGroup = { id: string; name: string; rows: Movement[]; totalIn: number; totalOut: number };

/** The bucket a row belongs to under a given group-by — null means "no single
 *  bucket" (e.g. a payment has no employee), which falls through to the
 *  ungrouped "other" list rather than a fake one-row group. */
function groupKey(movement: Movement, groupBy: LedgerGroupBy): { id: string; name: string } | null {
  switch (groupBy) {
    case "none":
      return null;
    case "employee":
      return movement.employeeId ? { id: movement.employeeId, name: movement.employeeName ?? "עובד" } : null;
    case "category":
      return movement.category ? { id: movement.category, name: movement.category } : null;
    case "date":
      return movement.date ? { id: movement.date.slice(0, 10), name: formatDate(movement.date) } : null;
  }
}

/** "קיבוץ לפי עובד" generalized to any of the four group-by values — same
 *  bucket/other split, just keyed by a different field per groupKey() above. */
function groupMovements(
  movements: Movement[],
  groupBy: LedgerGroupBy
): { groups: MovementGroup[]; other: Movement[] } {
  if (groupBy === "none") return { groups: [], other: movements };
  const byId = new Map<string, MovementGroup>();
  const other: Movement[] = [];
  for (const movement of movements) {
    const key = groupKey(movement, groupBy);
    if (!key) {
      other.push(movement);
      continue;
    }
    let group = byId.get(key.id);
    if (!group) {
      group = { id: key.id, name: key.name, rows: [], totalIn: 0, totalOut: 0 };
      byId.set(key.id, group);
    }
    group.rows.push(movement);
    if (movement.amount !== null) {
      if (movement.direction === "in") group.totalIn += movement.amount;
      else group.totalOut += movement.amount;
    }
  }
  const groups = [...byId.values()];
  if (groupBy === "date") {
    // Newest first — matches the ledger's own default order (ids are
    // YYYY-MM-DD, so lexicographic sort is chronological).
    groups.sort((a, b) => b.id.localeCompare(a.id));
  } else {
    // Biggest bucket first — "who/what costs the most" without scanning.
    groups.sort((a, b) => b.totalIn + b.totalOut - (a.totalIn + a.totalOut));
  }
  return { groups, other };
}

function compareMovements(a: Movement, b: Movement, sortBy: LedgerSortBy): number {
  switch (sortBy) {
    case "date": {
      const at = a.date ? new Date(a.date).getTime() : 0;
      const bt = b.date ? new Date(b.date).getTime() : 0;
      return at - bt;
    }
    case "amount":
      return (a.amount ?? 0) - (b.amount ?? 0);
    case "status": {
      const al = a.status ? getStatusLabel("payment", a.status) : "";
      const bl = b.status ? getStatusLabel("payment", b.status) : "";
      return al.localeCompare(bl, "he");
    }
  }
}

function sortMovements(movements: Movement[], sortBy: LedgerSortBy, direction: LedgerSortDirection): Movement[] {
  const sorted = [...movements].sort((a, b) => compareMovements(a, b, sortBy));
  if (direction === "desc") sorted.reverse();
  return sorted;
}

const TH = "px-2 py-1.5 text-start text-xs font-medium text-muted-foreground";
const TD = "px-2 py-2 align-top";

export default function ProjectMovements({
  movements,
  groupBy,
  sortBy,
  sortDirection,
}: {
  movements: Movement[];
  /** קיבוץ — from the תצוגה dropdown in the section header. */
  groupBy: LedgerGroupBy;
  /** מיון — from the same dropdown. */
  sortBy: LedgerSortBy;
  sortDirection: LedgerSortDirection;
}) {
  const [openKeys, setOpenKeys] = useState<Record<string, boolean>>({});
  // One row's actions uncovered at a time, like every other swipe list here.
  const [swipedKey, setSwipedKey] = useState<string | null>(null);
  // Each group starts collapsed — the subtotal on its header already answers
  // "how much", no need to open it.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  function toggle(key: string) {
    setOpenKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  }
  function toggleGroup(id: string) {
    setOpenGroups((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  const sorted = useMemo(() => sortMovements(movements, sortBy, sortDirection), [movements, sortBy, sortDirection]);

  // Ties out to מחיר בפועל / הוצאות in the summary card beside it — the whole
  // set, always (no filter to shrink it anymore).
  const totals = useMemo(
    () =>
      movements.reduce(
        (acc, m) => {
          if (m.amount !== null) {
            if (m.direction === "in") acc.in += m.amount;
            else acc.out += m.amount;
          }
          if (m.billedAmount !== null) acc.billed += m.billedAmount;
          return acc;
        },
        { in: 0, out: 0, billed: 0 }
      ),
    [movements]
  );

  const { groups, other } = useMemo(() => groupMovements(sorted, groupBy), [sorted, groupBy]);

  if (movements.length === 0) {
    return <p className="text-muted-foreground">אין תנועות להצגה.</p>;
  }

  function desktopRow(movement: Movement) {
    const expandable = hasDetails(movement);
    const open = expandable && Boolean(openKeys[movement.key]);
    return (
      <Fragment key={movement.key}>
        <tr
          className={cn(
            "hover:bg-accent/40",
            // The border marks the end of this movement's own block — it
            // sits on the detail row instead when one is open, so nothing
            // separates a row from its own expansion.
            open ? "bg-muted/10" : "border-b border-border/70"
          )}
        >
          <td className={TD}>
            {expandable ? (
              <button
                type="button"
                onClick={() => toggle(movement.key)}
                aria-expanded={open}
                aria-label={open ? "סגירת פרטים" : "פתיחת פרטים"}
                className="text-muted-foreground"
              >
                <ChevronDownIcon className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
              </button>
            ) : null}
          </td>
          <td className={TD + " whitespace-nowrap text-muted-foreground"}>
            <LtrInline>{formatDate(movement.date)}</LtrInline>
          </td>
          <td className={TD}>
            <div className="flex flex-wrap items-center gap-1.5">
              {movement.category ? <CategoryChip label={movement.category} /> : null}
              {movementNameRepeatsCategory(movement) ? null : (
                <span className="font-semibold">{movement.name}</span>
              )}
              {hasAttachment(movement) ? <AttachmentHint /> : null}
            </div>
            {movement.hint ? (
              <div className="mt-0.5 text-xs text-muted-foreground">{movement.hint}</div>
            ) : null}
          </td>
          <td className={TD}>
            {movement.status ? (
              <StatusBadge value={movement.status} type="payment" dueDate={movement.dueDate} />
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </td>
          <td className={TD + " whitespace-nowrap font-semibold tabular-nums"}>
            <BilledCell amount={movement.billedAmount} />
          </td>
          <td className={TD + " whitespace-nowrap font-semibold tabular-nums"}>
            <AmountCell movement={movement} side="in" />
          </td>
          <td className={TD + " whitespace-nowrap font-semibold tabular-nums"}>
            <AmountCell movement={movement} side="out" />
          </td>
          <td className={TD}>
            <RowActions movement={movement} />
          </td>
        </tr>
        {open ? (
          <tr className="border-b border-border/70 bg-muted/10">
            <td />
            <td className="ps-6 pb-3 pt-0" colSpan={7}>
              <Details movement={movement} />
            </td>
          </tr>
        ) : null}
      </Fragment>
    );
  }

  function desktopGroupHeader(group: MovementGroup) {
    const open = Boolean(openGroups[group.id]);
    return (
      <tr
        key={`group:${group.id}`}
        className="cursor-pointer border-b border-border/70 bg-muted/30 hover:bg-muted/40"
        onClick={() => toggleGroup(group.id)}
        aria-expanded={open}
      >
        <td className={TD}>
          <ChevronDownIcon className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
        </td>
        <td className={TD + " font-semibold"} colSpan={4}>
          {group.name}
          <span className="ms-1.5 text-xs font-normal text-muted-foreground">· {group.rows.length} תנועות</span>
        </td>
        <td className={TD + " whitespace-nowrap font-semibold tabular-nums text-success"}>
          {group.totalIn > 0 ? <LtrInline>{formatIls(group.totalIn)}</LtrInline> : "—"}
        </td>
        <td className={TD + " whitespace-nowrap font-semibold tabular-nums text-destructive"}>
          {group.totalOut > 0 ? <LtrInline>{formatIls(group.totalOut)}</LtrInline> : "—"}
        </td>
        <td className={TD} />
      </tr>
    );
  }

  function mobileRow(movement: Movement) {
    const expandable =
      hasDetails(movement) ||
      Boolean(movement.date) ||
      Boolean(movement.status) ||
      movement.billed ||
      Boolean(movement.onEdit) ||
      Boolean(movement.onDelete);
    const open = expandable && Boolean(openKeys[movement.key]);
    return (
      <li key={movement.key}>
        <SwipeActions
          className="rounded-none"
          open={swipedKey === movement.key}
          onOpenChange={(next) => setSwipedKey(next ? movement.key : null)}
          actions={
            movement.onEdit || movement.onDelete
              ? [
                  ...(movement.onEdit
                    ? [
                        {
                          key: "edit",
                          label: "עריכה",
                          icon: <EditIcon className="h-4 w-4" />,
                          onSelect: movement.onEdit,
                          className: "bg-secondary text-secondary-foreground",
                        },
                      ]
                    : []),
                  ...(movement.onDelete
                    ? [
                        {
                          key: "delete",
                          label: "מחיקה",
                          icon: <DeleteIcon className="h-4 w-4" />,
                          onSelect: movement.onDelete,
                          className: "bg-destructive text-destructive-foreground",
                        },
                      ]
                    : []),
                ]
              : []
          }
        >
          <div className="bg-card py-2">
            <button
              type="button"
              onClick={() => (expandable ? toggle(movement.key) : undefined)}
              aria-expanded={open}
              disabled={!expandable}
              className="flex w-full items-start gap-2 text-start disabled:cursor-default"
            >
              {expandable ? (
                <ChevronDownIcon
                  className={cn(
                    "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                    open && "rotate-180"
                  )}
                />
              ) : (
                <span className="h-4 w-4 shrink-0" />
              )}
              {/* A dot for the payment state, then what it is, what it was
                  for, and how much. The spelled-out badge and the date wait
                  behind the chevron. */}
              {movement.status ? <StatusDot status={movement.status} /> : null}
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  {movement.category ? <CategoryChip label={movement.category} /> : null}
                  {movementNameRepeatsCategory(movement) ? null : (
                    <span className="font-medium">{movement.name}</span>
                  )}
                  {hasAttachment(movement) ? <AttachmentHint /> : null}
                </span>
                {movement.hint ? (
                  <span className="block text-xs text-muted-foreground">{movement.hint}</span>
                ) : null}
              </span>
              <span className="shrink-0 text-end">
                <span className="block whitespace-nowrap font-semibold tabular-nums">
                  <span className={movement.direction === "in" ? "text-success" : "text-destructive"}>
                    <LtrInline>
                      {movement.direction === "in" ? "+" : "-"} {formatIls(Math.abs(movement.amount ?? 0))}
                    </LtrInline>
                  </span>
                </span>
                {/* Right under the amount it annotates, not up beside the
                    name — a reader connects the two only when they're
                    actually stacked. */}
                {movement.billed && movement.billedAmount !== null ? (
                  <BilledMark amount={movement.billedAmount} className="mt-0.5" />
                ) : null}
              </span>
            </button>

            {open ? <ExpandedCard movement={movement} /> : null}
          </div>
        </SwipeActions>
      </li>
    );
  }

  function mobileGroupHeader(group: MovementGroup) {
    const open = Boolean(openGroups[group.id]);
    return (
      <li key={`group:${group.id}`} className="bg-muted/30">
        <button
          type="button"
          onClick={() => toggleGroup(group.id)}
          aria-expanded={open}
          className="flex w-full items-center gap-2 px-1 py-2.5 text-start"
        >
          <ChevronDownIcon
            className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
          />
          <span className="min-w-0 flex-1">
            <span className="block font-medium">{group.name}</span>
            <span className="block text-xs text-muted-foreground">{group.rows.length} תנועות</span>
          </span>
          <span className="shrink-0 whitespace-nowrap text-end font-semibold tabular-nums">
            {group.totalIn > 0 ? (
              <span className="block text-success">
                <LtrInline>+ {formatIls(group.totalIn)}</LtrInline>
              </span>
            ) : null}
            {group.totalOut > 0 ? (
              <span className="block text-destructive">
                <LtrInline>- {formatIls(group.totalOut)}</LtrInline>
              </span>
            ) : null}
          </span>
        </button>
      </li>
    );
  }

  const grouped = groupBy !== "none";

  return (
    <>
      {/* Desktop: a table, because there's width for the columns.
          max-h capped here (not on an ancestor) so the row list's own
          scroll budget never competes with however tall the action
          buttons above it happen to be at a given text scale. */}
      <div className="hidden max-h-[min(32rem,55dvh)] min-h-0 flex-1 overflow-y-auto lg:block">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b">
              <th className="w-8 px-2 py-1.5" />
              <th className={TH}>תאריך</th>
              <th className={TH}>תיאור</th>
              <th className={TH}>סטטוס</th>
              <th className={TH}>לחיוב לקוח</th>
              <th className={TH}>הכנסה</th>
              <th className={TH}>הוצאה</th>
              <th className={TH + " w-16 text-center"}>פעולות</th>
            </tr>
          </thead>
          <tbody>
            {grouped
              ? [
                  ...groups.map((group) => (
                    <Fragment key={group.id}>
                      {desktopGroupHeader(group)}
                      {openGroups[group.id] ? group.rows.map(desktopRow) : null}
                    </Fragment>
                  )),
                  ...other.map(desktopRow),
                ]
              : sorted.map(desktopRow)}
          </tbody>
          {/* Reconciles against סיכום כספי beside it — מחיר בפועל / הוצאות.
              Sticky like the header, so it never scrolls out of view on a
              long ledger. */}
          <tfoot className="sticky bottom-0 z-10">
            <tr className="border-t-2 border-foreground/20 bg-muted font-semibold">
              <td />
              <td className={TD} colSpan={3}>
                סה״כ
              </td>
              <td className={TD + " whitespace-nowrap tabular-nums text-secondary"}>
                <LtrInline>{formatIls(totals.billed)}</LtrInline>
              </td>
              <td className={TD + " whitespace-nowrap tabular-nums text-success"}>
                <LtrInline>{formatIls(totals.in)}</LtrInline>
              </td>
              <td className={TD + " whitespace-nowrap tabular-nums text-destructive"}>
                <LtrInline>{formatIls(totals.out)}</LtrInline>
              </td>
              <td className={TD} />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Phone: one card per movement, same expander. No totals footer here —
          סיכום כספי (the financial summary card elsewhere on this page)
          already states חיובים ללקוח/הוצאות; repeating them here just ate
          into the row list's already-tight share of a phone screen. max-h
          capped directly on the list (not an ancestor) so its scroll budget
          never competes with however tall the action buttons above it
          happen to be at a given text scale. */}
      <ul className="max-h-[min(32rem,55dvh)] min-h-0 flex-1 divide-y overflow-y-auto lg:hidden">
        {grouped
          ? [
              ...groups.map((group) => (
                <Fragment key={group.id}>
                  {mobileGroupHeader(group)}
                  {openGroups[group.id] ? group.rows.map(mobileRow) : null}
                </Fragment>
              )),
              ...other.map(mobileRow),
            ]
          : sorted.map(mobileRow)}
      </ul>
    </>
  );
}

"use client";

// One ledger for the project's money: every payment in, every expense and wage
// out, newest first. It replaces the הוצאות / הכנסות / לחיוב לקוח / תזרים
// quartet, where each row appeared twice. Totals aren't repeated here — סיכום
// כספי is the summary; this is the statement.
//
// A row shows the six things you scan for (date, what, status, a hint, a file,
// the amount). Everything else — notes, method, reference, session hours, who
// recorded it, attachments — waits behind the row's chevron, so the common case
// stays one line.

import { useState } from "react";
import { ChevronDown, MoreHorizontal, Paperclip, Pencil, Trash2, Loader2 } from "lucide-react";
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
import { formatIls, formatDate, LtrInline } from "./ProjectTabsClient.helpers";

export type Movement = {
  key: string;
  direction: "in" | "out";
  date: string | null;
  title: string;
  /** Payment-status value for StatusBadge; null for rows that have no status. */
  status: string | null;
  /** Re-charged to the customer — the לחיוב לקוח list, as a marker. */
  billed: boolean;
  amount: number | null;
  /** One-line hint shown in the row (notes, method, period…). */
  hint: string | null;
  /** Label/value pairs shown when the row is opened. */
  extras: { label: string; value: string }[];
  attachments: FinancialAttachment[];
  busy?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
};

function BilledChip() {
  return (
    <span className="inline-flex items-center rounded-full border border-warning/50 bg-warning-soft px-1.5 py-0 text-[0.6875rem] font-medium text-warning-soft-foreground">
      חויב ללקוח
    </span>
  );
}

function Amount({ movement }: { movement: Movement }) {
  if (movement.amount === null) return <span>—</span>;
  return (
    <span className={movement.direction === "in" ? "text-success" : "text-destructive"}>
      <LtrInline>
        {movement.direction === "in" ? "+" : "-"} {formatIls(Math.abs(movement.amount))}
      </LtrInline>
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
          <Paperclip className="h-3 w-3" />
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
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <MoreHorizontal className="h-4 w-4" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        {movement.onEdit ? (
          <DropdownMenuItem onClick={movement.onEdit}>
            <Pencil className="me-2 h-4 w-4" />
            עריכה
          </DropdownMenuItem>
        ) : null}
        {movement.onDelete ? (
          <DropdownMenuItem
            onClick={movement.onDelete}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="me-2 h-4 w-4" />
            מחיקה
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function hasDetails(movement: Movement) {
  return movement.extras.length > 0 || movement.attachments.some((attachment) => attachment.url);
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
              <dd className="min-w-0 break-words font-medium">{extra.value}</dd>
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
  const facts = movement.extras
    .filter((extra) => extra.label !== "נרשם")
    .map((extra) => `${extra.label}: ${extra.value}`)
    .join(" · ");
  const files = movement.attachments.filter((attachment) => attachment.url);

  return (
    <div className="mt-2 space-y-1.5 ps-6 text-xs">
      {/* Date leads: it's what the eye looks for first in a statement. */}
      <div className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
        <LtrInline>{formatDate(movement.date)}</LtrInline>
        {movement.status ? <StatusBadge value={movement.status} type="payment" /> : null}
        {movement.billed ? <BilledChip /> : null}
      </div>

      {facts ? <div className="break-words text-muted-foreground">{facts}</div> : null}

      {recordedBy || files.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-muted-foreground">
          <span className="min-w-0 break-words">{recordedBy ?? ""}</span>
          {files.length > 0 ? <Attachments attachments={movement.attachments} /> : null}
        </div>
      ) : null}
    </div>
  );
}

const TH = "px-2 py-1.5 text-start text-xs font-medium text-muted-foreground";
const TD = "px-2 py-2 align-top";

export default function ProjectMovements({ movements }: { movements: Movement[] }) {
  const [openKeys, setOpenKeys] = useState<Record<string, boolean>>({});
  // One row's actions uncovered at a time, like every other swipe list here.
  const [swipedKey, setSwipedKey] = useState<string | null>(null);

  function toggle(key: string) {
    setOpenKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  if (movements.length === 0) {
    return <p className="text-muted-foreground">אין תנועות להצגה.</p>;
  }

  return (
    <>
      {/* Desktop: a table, because there's width for the six columns. */}
      <div className="hidden min-h-0 flex-1 overflow-y-auto lg:block">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b">
              <th className="w-8 px-2 py-1.5" />
              <th className={TH}>תאריך</th>
              <th className={TH}>תיאור</th>
              <th className={TH}>סטטוס</th>
              <th className={TH}>פרטים</th>
              <th className={TH}>קובץ מצורף</th>
              <th className={TH + " text-end"}>סכום</th>
              <th className={TH + " w-16 text-center"}>פעולות</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {movements.map((movement) => {
              const expandable = hasDetails(movement);
              const open = expandable && Boolean(openKeys[movement.key]);
              return (
                <>
                  <tr key={movement.key} className="hover:bg-accent/40">
                    <td className={TD}>
                      {expandable ? (
                        <button
                          type="button"
                          onClick={() => toggle(movement.key)}
                          aria-expanded={open}
                          aria-label={open ? "סגירת פרטים" : "פתיחת פרטים"}
                          className="text-muted-foreground"
                        >
                          <ChevronDown
                            className={cn("h-4 w-4 transition-transform", open && "rotate-180")}
                          />
                        </button>
                      ) : null}
                    </td>
                    <td className={TD + " whitespace-nowrap text-muted-foreground"}>
                      <LtrInline>{formatDate(movement.date)}</LtrInline>
                    </td>
                    <td className={TD + " font-semibold"}>
                      <span className="break-words">{movement.title}</span>
                      {movement.billed ? (
                        <span className="ms-1.5">
                          <BilledChip />
                        </span>
                      ) : null}
                    </td>
                    <td className={TD}>
                      {movement.status ? (
                        <StatusBadge value={movement.status} type="payment" />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className={TD + " text-xs text-muted-foreground"}>
                      {movement.hint ? <span className="break-words">{movement.hint}</span> : "—"}
                    </td>
                    <td className={TD + " text-xs"}>
                      <Attachments attachments={movement.attachments} />
                    </td>
                    <td className={TD + " whitespace-nowrap text-end font-semibold tabular-nums"}>
                      <Amount movement={movement} />
                    </td>
                    <td className={TD}>
                      <RowActions movement={movement} />
                    </td>
                  </tr>
                  {open ? (
                    <tr key={`${movement.key}:details`} className="bg-muted/20">
                      <td />
                      <td className="px-2 pb-3" colSpan={7}>
                        <Details movement={movement} />
                      </td>
                    </tr>
                  ) : null}
                </>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Phone: one card per movement, same expander. */}
      <ul className="min-h-0 flex-1 divide-y overflow-y-auto lg:hidden">
        {movements.map((movement) => {
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
                                icon: <Pencil className="h-4 w-4" />,
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
                                icon: <Trash2 className="h-4 w-4" />,
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
                  <ChevronDown
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
                  <span className="block break-words font-medium">{movement.title}</span>
                  {movement.hint ? (
                    <span className="block break-words text-xs text-muted-foreground">
                      {movement.hint}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 whitespace-nowrap font-semibold tabular-nums">
                  <Amount movement={movement} />
                </span>
              </button>

              {open ? <ExpandedCard movement={movement} /> : null}
              </div>
              </SwipeActions>
            </li>
          );
        })}
      </ul>
    </>
  );
}

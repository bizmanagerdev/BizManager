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
import { ChevronDown, Paperclip, Pencil, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
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
    <div className="flex shrink-0 items-center gap-1">
      {movement.onEdit ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 w-8 p-0"
          disabled={movement.busy}
          onClick={movement.onEdit}
          title="עריכה"
          aria-label="עריכה"
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      ) : null}
      {movement.onDelete ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 w-8 border-destructive/40 p-0 text-destructive hover:bg-destructive/10"
          disabled={movement.busy}
          onClick={movement.onDelete}
          title="מחיקה"
          aria-label="מחיקה"
        >
          {movement.busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" />
          )}
        </Button>
      ) : null}
    </div>
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
        <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
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

const TH = "px-2 py-1.5 text-start text-xs font-medium text-muted-foreground";
const TD = "px-2 py-2 align-top";

export default function ProjectMovements({ movements }: { movements: Movement[] }) {
  const [openKeys, setOpenKeys] = useState<Record<string, boolean>>({});

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
              <th className="w-20 px-2 py-1.5" />
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
            <li key={movement.key} className="py-2">
              <button
                type="button"
                onClick={() => (expandable ? toggle(movement.key) : undefined)}
                aria-expanded={open}
                disabled={!expandable}
                className="flex w-full items-center gap-2 text-start disabled:cursor-default"
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
                {/* Three things and no more: what it is, what it was for, how
                    much. Date, status and the rest wait behind the chevron. */}
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

              {open ? (
                <div className="mt-2 space-y-2 ps-6">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <LtrInline>{formatDate(movement.date)}</LtrInline>
                    {movement.status ? (
                      <StatusBadge value={movement.status} type="payment" />
                    ) : null}
                    {movement.billed ? <BilledChip /> : null}
                  </div>
                  <Details movement={movement} />
                  <RowActions movement={movement} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </>
  );
}

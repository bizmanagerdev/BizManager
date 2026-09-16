"use client";

import Link from "next/link";
import { AddReminderIcon, CheckIcon, DeleteIcon, EditIcon, ExternalLinkIcon, MoreIcon, SplitIcon } from "@/components/ui/icons";
import { DeleteButton, EditButton } from "@/components/ui/icon-button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MetaRow } from "@/components/ui/meta-row";
import type { PaymentCalendarItem } from "@/lib/payables";
import { DIRECTION_WORDS, STAGE_BADGE, STAGE_DOT, amountLabel, itemStageKey, stageLabelFor } from "./calendar.helpers";

// ── Shared item card (used by the day panel and anywhere a payment is listed) ───
export default function PaymentItemCard({
  item,
  onMarkPaid,
  onSplit,
  onRemind,
  onDelete,
  onEdit,
  editLabel = "עריכה",
  compact = false,
  accountName,
}: {
  item: PaymentCalendarItem;
  onMarkPaid: () => void;
  onSplit: () => void;
  onRemind: () => void;
  // Absent when the row can't be deleted from the board (see actionsFor).
  onDelete?: () => void;
  // Absent on items that have no editable record here (wages, loans, card charges).
  onEdit?: () => void;
  editLabel?: string;
  compact?: boolean;
  accountName?: string;
}) {
  const stage = itemStageKey(item);
  const words = DIRECTION_WORDS[item.direction];
  const incoming = item.direction === "in";
  const isForecast = Boolean(item.recurringTemplateId) && !item.expenseId;
  // Auto-paid (הוראת קבע) needs no approval → no mark-paid button.
  // A forecast is a period that has no expense row yet, so it always needs a way
  // to be recorded — INCLUDING a standing order. "Auto-paid" only means the
  // generator stamps it paid when it creates it; until then there is nothing in
  // the ledger, nothing to reconcile against the bank, and no other way in.
  // Rows that already exist and are paid are filtered by the stage check below.
  const canMarkPaid = incoming ? Boolean(item.paymentId) : Boolean(item.expenseId) || isForecast;
  const canSplit = Boolean(item.expenseId);
  const canDelete = Boolean(onDelete);
  // Drop the source label from the meta when a type badge (הוראת קבע / קבועה) already
  // says the same thing — no info twice.
  const showsTypeBadge = item.autoPaid || isForecast;
  const metaItems = [
    item.domainName,
    showsTypeBadge ? null : item.sourceLabel,
    incoming && item.reference ? `אסמכתא ${item.reference}` : null,
    accountName ? `${incoming ? "לחשבון" : "מחשבון"} ${accountName}` : null,
  ];
  const metaLine = metaItems.filter(Boolean).join(" • ");
  const amountText = amountLabel(item);
  const noteText = item.notes?.trim() || "";

  // Compact single-block row for the day panel: title + amount on one line,
  // source + icon actions on the next. Icon-only buttons keep rows narrow.
  if (compact) {
    // The day panel is a narrow column: text gets the full width and wraps
    // (never clipped), the ONE action people take here — סמן כשולם — stays a
    // visible button, and everything else lives behind ⋯ (same pattern as the
    // dense tables). Six icon buttons beside the meta line squeezed it into a
    // one-word-per-line sliver.
    const showMarkPaid = canMarkPaid && item.stage !== "posted";
    return (
      <div className="rounded-lg border bg-background px-3 py-2.5" data-focus-id={item.id}>
        {/* Row 1: name (wraps) + amount. Badges get their own row so nothing crams. */}
        <div className="flex items-start gap-2">
          <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${STAGE_DOT[stage]}`} />
          <span className="min-w-0 flex-1 break-words text-sm font-medium leading-snug">{item.label}</span>
          <span className="shrink-0 text-sm font-semibold tabular-nums">
            <span className={incoming ? "text-success" : "text-destructive"}>{incoming ? "+" : "−"}</span>
            {amountText}
          </span>
        </div>
        {item.autoPaid || isForecast || item.variableAmount ? (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {item.autoPaid ? <Badge variant="outline">הוראת קבע</Badge> : isForecast ? <Badge variant="neutral">קבועה</Badge> : null}
            {item.variableAmount ? <Badge variant="warning">משתנה</Badge> : null}
          </div>
        ) : null}
        {noteText ? (
          <div className="mt-1.5 break-words text-xs text-muted-foreground">הערה: {noteText}</div>
        ) : null}
        <MetaRow className="mt-1.5 text-xs text-muted-foreground" items={metaItems} />
        <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2">
          {showMarkPaid ? (
            <Button type="button" size="sm" variant="secondary" onClick={onMarkPaid}>
              <CheckIcon className="h-3.5 w-3.5" />
              {words.markAction}
            </Button>
          ) : (
            <span />
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 w-8 shrink-0 p-0 text-muted-foreground hover:text-foreground"
                title="פעולות"
                aria-label={`פעולות — ${item.label}`}
              >
                <MoreIcon className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              {onEdit ? (
                <DropdownMenuItem onClick={onEdit}>
                  <EditIcon className="me-2 h-4 w-4" />
                  {editLabel}
                </DropdownMenuItem>
              ) : null}
              {canSplit && item.stage !== "posted" ? (
                <DropdownMenuItem onClick={onSplit}>
                  <SplitIcon className="me-2 h-4 w-4" />
                  פיצול לתשלומים
                </DropdownMenuItem>
              ) : null}
              {item.sourceHref ? (
                <DropdownMenuItem asChild>
                  <Link href={item.sourceHref}>
                    <ExternalLinkIcon className="me-2 h-4 w-4" />
                    למקור
                  </Link>
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onClick={onRemind}>
                <AddReminderIcon className="me-2 h-4 w-4" />
                תזכורת
              </DropdownMenuItem>
              {canDelete ? (
                <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
                  <DeleteIcon className="me-2 h-4 w-4" />
                  מחיקה
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-background p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{item.label}</span>
        <span className="font-semibold">{amountText}</span>
        <Badge variant={STAGE_BADGE[stage]}>{stageLabelFor(item, stage)}</Badge>
        {item.autoPaid ? <Badge variant="outline">הוראת קבע</Badge> : isForecast ? <Badge variant="neutral">הוצאה קבועה</Badge> : null}
        {item.variableAmount ? <Badge variant="warning">משתנה</Badge> : null}
        {item.installmentGroupId && item.installmentIndex && item.installmentCount ? (
          <Badge variant="neutral">
            תשלום {item.installmentIndex}/{item.installmentCount}
          </Badge>
        ) : null}
      </div>
      <div className="mt-0.5 text-sm text-muted-foreground">
        {metaLine}
      </div>
      {noteText ? (
        <div className="mt-0.5 text-sm text-muted-foreground">הערה: {noteText}</div>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {canMarkPaid && item.stage !== "posted" ? (
          <Button type="button" size="sm" variant="secondary" onClick={onMarkPaid}>
            <CheckIcon className="h-3.5 w-3.5" />
            {words.markAction}
          </Button>
        ) : null}
        {canSplit && item.stage !== "posted" ? (
          <Button type="button" size="sm" variant="secondary" onClick={onSplit}>
            <SplitIcon className="h-3.5 w-3.5" />
            פיצול לתשלומים
          </Button>
        ) : null}
        {onEdit ? <EditButton onClick={onEdit} label={editLabel} /> : null}
        {item.sourceHref ? (
          <Button asChild type="button" size="sm" variant="secondary">
            <Link href={item.sourceHref}>
              <ExternalLinkIcon className="h-3.5 w-3.5" />
              למקור
            </Link>
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="secondary" onClick={onRemind}>
          <AddReminderIcon className="h-3.5 w-3.5" />
          תזכורת
        </Button>
        {canDelete ? (
          <DeleteButton onClick={onDelete} />
        ) : null}
      </div>
    </div>
  );
}

"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DataTableShell } from "@/components/ui/data-table-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { TOGGLE_ON, TOGGLE_ON_HOVER, TOOLBAR_CONTROL } from "@/components/ui/filter-chip";
import { CountBadge } from "@/components/ui/count-badge";
import { IconButton } from "@/components/ui/icon-button";
import { DocumentLink } from "@/components/ui/document-tile";
import { ResponsiveDataView } from "@/components/ui/responsive-data-view";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ViewDialog } from "@/components/ui/view-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MonthStepper } from "@/components/ui/month-calendar";
import {
  AttachIcon,
  CalendarIcon,
  ChatIcon,
  ChecklistIcon,
  ChevronDownIcon,
  CloseIcon,
  DownloadIcon,
  FilterIcon,
  MoreIcon,
  PrintIcon,
} from "@/components/ui/icons";
import { PageStack } from "@/components/layout/page-layout";
import { useUndoOverlay } from "@/hooks/useUndoOverlay";
import { CONNECTION_EVENTS } from "@/lib/offline-queue";
import { scheduleDeferredEdit } from "@/lib/undo-engine";
import { sendChange } from "@/lib/offline-send";
import { formatShortDate } from "@/lib/date";
import { formatCurrency } from "@/lib/payroll";
import { paymentMethodLabel } from "@/lib/orders/paymentStatus";
import { whatsappHref } from "@/lib/whatsapp";
import { STATUS_PILL_CLASSES } from "@/lib/ui/status-color-classes";
import type { FinancialAttachment } from "@/lib/payments";
import {
  propertyDisplayName,
  type PropertyPayment,
  type RentRollData,
  type RentRollPayment,
  type RentRollProperty,
} from "@/lib/properties";
import { paidTowards, paymentPeriodLabel, RENT_STATE, type RentMonthState } from "@/lib/property-rent";
import {
  daysBetween,
  lateThisMonth,
  rentRollOffsetFor,
  rentRollToday,
  rentRollYear,
  rentRowOwes,
  toRollRent,
  type RentDebt,
  type RentRollRow,
  type RentRollYear,
  type RentToDo,
} from "@/lib/rent-roll";
import { rentPeriodLabel } from "@/lib/rent-periods";
import { israelDateKey } from "@/lib/timezone";
import { cn } from "@/lib/utils";
import PropertyRentPaymentDialog from "@/app/(app)/properties/[id]/PropertyRentPaymentDialog";
import PropertyCheckArrivedDialog from "@/app/(app)/properties/[id]/PropertyCheckArrivedDialog";
import { deposit, downloadExcel, monthSheet, printSheet, yearSheet } from "./rentRollExport";

// The rent page (owner, 2026-10-21). Redone after looking at how property
// software lays it out (the owner: "it doesn't tell you what to do … the
// numbers one after the next … switching between the months doesn't feel
// right; the year thing is better"): "היום" — what needs doing, each with its
// button; four plain figures; then each lease, the most urgent first, one
// row each, its details opening under it — and "לוח שנתי", the year at a
// glance with the checks in hand for the months ahead. The checks themselves
// are managed on the checks page (owner: "we already have a separate page to
// manage checks"); the figures here link to it, filtered to rent. Built of
// the app's own parts (owner, same day: "everything needs to be designed
// according to our design system"): the underline tabs, a folding section,
// cards, the filter chip, the table shell and its row and cell sizes.

const paymentKey = (p: RentRollPayment) => p.id;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Checks running out this soon: in colour. */
const SOON_DAYS = 60;

/** The checks page, showing every property's rent checks (or one property's). */
const rentChecksHref = (propertyId?: string, filter?: "week") =>
  `/checks?property=${propertyId ?? "rent"}${filter ? `&filter=${filter}` : ""}`;

/** The table's cells — the customers list's sizes. */
const HEAD_CELL = "whitespace-nowrap px-2 py-2 font-medium";
const CELL = "px-2 py-1.5";
/** A row's own buttons — the collections list's size. */
const ROW_BUTTON = "h-7 text-xs";

type Tab = "month" | "year";
type Place = { property: RentRollProperty; lease: { unitLabel: string | null } };

/** Two records of the same rent: one just saved here, one read back from the server. */
function sameRent(a: PropertyPayment, b: PropertyPayment): boolean {
  return (
    a.leaseId === b.leaseId &&
    a.rentPeriodStart === b.rentPeriodStart &&
    a.method === b.method &&
    a.accountId === b.accountId &&
    Math.abs(a.amount - b.amount) < 0.5
  );
}

function placeName(row: Place): string {
  const unit = row.lease.unitLabel?.trim();
  const name = propertyDisplayName(row.property);
  return unit ? `${name} · ${unit}` : name;
}

/** The day the money comes in: a check's deposit date, any other payment's own. */
function moneyDate(payment: RentRollPayment): string {
  return formatShortDate(payment.method === "check" ? (payment.dueDate ?? payment.date) : payment.date, "—");
}

function methodWord(payment: RentRollPayment): string {
  if (payment.method === "check") return payment.checkNumber ? `צ׳ק #${payment.checkNumber}` : "צ׳ק";
  const label = paymentMethodLabel(payment.method);
  return label && label !== "-" ? label : "תשלום";
}

function checkName(payment: RentRollPayment): string {
  return payment.checkNumber ? `צ׳ק #${payment.checkNumber}` : "הצ׳ק";
}

/** The old debt in words: how many months, and how old its oldest part is ("2 חודשים · מעל 60 יום"). */
function debtWords(debt: RentDebt): string {
  return `${debt.periods === 1 ? "חודש אחד" : `${debt.periods} חודשים`} · ${debtAge(debt).label}`;
}

/** The old debt's age in days — its oldest part ("60+") — and the whole of it, by age, on hover. */
function debtAge(debt: RentDebt): { label: string; title: string } {
  const label = debt.over60 > 0.5 ? "מעל 60 יום" : debt.upTo60 > 0.5 ? "31–60 יום" : "עד 30 יום";
  const parts = [
    debt.upTo30 > 0.5 ? `עד 30 יום ${formatCurrency(debt.upTo30)}` : null,
    debt.upTo60 > 0.5 ? `31–60 יום ${formatCurrency(debt.upTo60)}` : null,
    debt.over60 > 0.5 ? `מעל 60 יום ${formatCurrency(debt.over60)}` : null,
  ].filter(Boolean);
  return { label, title: `${debt.periods === 1 ? "חודש אחד" : `${debt.periods} חודשים`} · ${parts.join(" · ")}` };
}

/** One fact in a row's details: its name small and grey above, its value — or a line per payment — under it. */
function DetailFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 text-sm">
      <div className="text-xs text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

/** A payment's files — a check's photo ("צילום"), a transfer's confirmation ("אישור") — each opening it. */
function PaymentFiles({ payment, files }: { payment: RentRollPayment; files: FinancialAttachment[] | undefined }) {
  const withUrl = (files ?? []).filter((f) => f.url);
  if (withUrl.length === 0) return null;
  const isCheck = payment.method === "check";
  const label = isCheck ? "צילום" : "אישור";
  return (
    <>
      {withUrl.map((file, i) => (
        <DocumentLink
          key={file.document_id}
          name={file.file_name ?? (isCheck ? "צילום הצ׳ק" : "אישור התשלום")}
          fileName={file.file_name}
          url={file.url as string}
          title={isCheck ? "צילום הצ׳ק" : "אישור התשלום"}
          className="inline-flex items-center gap-1 rounded-md border border-border/60 px-1.5 py-0.5 text-xs text-secondary hover:bg-accent"
        >
          <AttachIcon className="h-3 w-3" />
          {withUrl.length > 1 ? `${label} ${i + 1}` : label}
        </DocumentLink>
      ))}
    </>
  );
}

/** A year cell: the month's state in the app's status colours. A check in hand for a month ahead: outlined. */
const CELL_LOOK: Record<RentMonthState, { mark: string; className: string }> = {
  paid: { mark: "✓", className: STATUS_PILL_CLASSES.success },
  check: { mark: "צ׳", className: STATUS_PILL_CLASSES.info },
  partial: { mark: "½", className: STATUS_PILL_CLASSES.warning },
  late: { mark: "✗", className: STATUS_PILL_CLASSES.danger },
  upcoming: { mark: "·", className: STATUS_PILL_CLASSES.neutral },
  none: { mark: "", className: "" },
};
const AHEAD_CHECK = "border border-dashed border-info bg-transparent text-info-soft-foreground";

/** The property column stays in view while a wide table scrolls sideways. */
const STICKY = "sticky start-0 z-[1] bg-card";

export default function RentRollClient({ data }: { data: RentRollData }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  // One day for the whole visit: the months don't move under the owner's hand at midnight.
  const [today] = useState(() => israelDateKey());
  const [tab, setTab] = useState<Tab>("month");
  // The month shown — each lease's own, periods from this one — and the year's window, around it.
  const [offset, setOffset] = useState(0);
  const [owingOnly, setOwingOnly] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  // The rent recorded here, shown at once — until the page's own data has it.
  const [recorded, setRecorded] = useState<RentRollPayment[]>([]);
  // The payments' files (a check's photo) — from the server, after the page is on screen.
  const [files, setFiles] = useState<Record<string, FinancialAttachment[]>>({});

  const [paying, setPaying] = useState<{ row: RentRollRow; period: string } | null>(null);
  const [payingOpen, setPayingOpen] = useState(false);
  const [arrival, setArrival] = useState<{ payment: PropertyPayment; title: string } | null>(null);
  const [cell, setCell] = useState<RentRollRow | null>(null);
  // What needs handling: a small button in the row under the tabs, starting closed (owner, 2026-10-22: "should
  // start off closed … it just doesn't need to take up so much space"), its list opening OVER the page ("to open on
  // top of the page … overlay, not push down the page") — the collections filter panel's way.
  const [todoOpen, setTodoOpen] = useState(false);
  useEffect(() => {
    if (!todoOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTodoOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [todoOpen]);

  // Checks marked cleared, moved on, bounced or edited here show so at once (their patches).
  const overlaid = useUndoOverlay(data.payments, paymentKey, "property-payment");
  const payments = useMemo(() => {
    const shown = recorded.filter((r) => !overlaid.some((p) => p.id === r.id || sameRent(p, r)));
    return shown.length > 0 ? [...overlaid, ...shown] : overlaid;
  }, [overlaid, recorded]);
  const rollData = useMemo(() => ({ ...data, payments }), [data, payments]);
  // Now — what to do, the checks figures — and the month shown (the same, this month).
  const now = useMemo(() => rentRollToday(rollData, today), [rollData, today]);
  const view = useMemo(() => (offset === 0 ? now : rentRollToday(rollData, today, offset)), [now, rollData, today, offset]);
  const year = useMemo(() => (tab === "year" ? rentRollYear(rollData, offset, today) : null), [tab, rollData, offset, today]);
  const owing = view.rows.filter(rentRowOwes);
  const rows = owingOnly ? owing : view.rows;
  const { month } = view;
  const { todo } = now;
  const tiles = { ...view.tiles, deposit: now.tiles.deposit, inHand: now.tiles.inHand };

  // The rent alert's link — /rent#<lease>@<period> — opens that lease's row (a month ahead: in the year).
  useEffect(() => {
    const match = /^#([0-9a-f-]{36})@(\d{4}-\d{2}-\d{2})$/i.exec(window.location.hash);
    if (!match) return;
    const [, leaseId, period] = match;
    setOffset(rentRollOffsetFor(data, leaseId, period, today));
    setOpen(leaseId);
    requestAnimationFrame(() => {
      const wide = document.getElementById(`lease-${leaseId}`);
      (wide?.offsetParent ? wide : document.getElementById(`lease-m-${leaseId}`))?.scrollIntoView({ block: "center" });
    });
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A save waiting for signal went out: read the page again (the one saved here gives way to it).
  useEffect(() => {
    const refresh = () => startTransition(() => router.refresh());
    window.addEventListener(CONNECTION_EVENTS.synced, refresh);
    return () => window.removeEventListener(CONNECTION_EVENTS.synced, refresh);
  }, [router]);

  // The month's payments' files, the ones not asked for yet.
  const missingFiles = month.rows
    .flatMap((row) => [...row.payments, ...row.returned].map((p) => p.id))
    .filter((id) => UUID.test(id) && !(id in files))
    .sort()
    .join(",");
  useEffect(() => {
    if (!missingFiles || !navigator.onLine) return;
    let active = true;
    fetch(`/api/rent/files?ids=${missingFiles}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { files?: Record<string, FinancialAttachment[]> } | null) => {
        if (!active || !json?.files) return;
        const got = json.files;
        // Every id asked about gets an answer — none, when it has no file — so it isn't asked again.
        setFiles((prev) => ({ ...prev, ...Object.fromEntries(missingFiles.split(",").map((id) => [id, got[id] ?? []])) }));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [missingFiles]);

  const remember = useCallback((propertyId: string) => {
    return (payment: PropertyPayment) =>
      setRecorded((prev) => [...prev.filter((p) => p.id !== payment.id), { ...payment, propertyId }]);
  }, []);

  // The lease's usual way to pay: as its last payment came.
  const usual = paying
    ? ([...payments]
        .filter((p) => p.leaseId === paying.row.lease.id && p.paymentStatus !== "rejected")
        .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || b.id.localeCompare(a.id))[0] ?? null)
    : null;
  const payingPayments = paying ? payments.filter((p) => p.propertyId === paying.row.property.id) : [];
  const accountName = (id: string | null) => (id ? (data.accountNames[id] ?? "—") : "—");

  function openPayment(row: RentRollRow, period: string = row.period) {
    setCell(null);
    setPaying({ row, period });
    setPayingOpen(true);
  }

  /** A check that came back — or, undone, didn't: at once, with its undo; sent when the undo has passed. */
  function setBounced(payment: RentRollPayment, bounced: boolean) {
    scheduleDeferredEdit({
      scope: "property-payment",
      id: payment.id,
      message: bounced
        ? `${checkName(payment)} סומן כחוזר.`
        : payment.tornAt
          ? `${checkName(payment)} שוחזר.`
          : `${checkName(payment)} חזר לממתין.`,
      patch: bounced ? { paymentStatus: "rejected" } : { paymentStatus: "pending", tornAt: null },
      // With no signal it waits on the device and goes out with the connection.
      onCommit: async () => {
        const sent = await sendChange(
          "/api/payments/mark-collected",
          bounced ? { id: payment.id, bounced: true } : { id: payment.id, collected: false },
          bounced ? "צ׳ק חזר" : "צ׳ק לממתין",
          "עדכון הצ׳ק נכשל."
        );
        if (!sent.ok) return { ok: false, error: sent.error };
        if (!sent.queued) startTransition(() => router.refresh());
        return { ok: true };
      },
    });
  }

  /** The row's one main button, by where its rent stands. */
  function mainAction(row: RentRollRow): ReactNode {
    const pending = row.payments.find((p) => p.method === "check" && p.paymentStatus === "pending") ?? null;
    if (pending && (pending.dueDate ?? pending.date ?? "") <= today) {
      return (
        <Button
          type="button"
          size="sm"
          className={ROW_BUTTON}
          onClick={() => setArrival({ payment: pending, title: `שכירות ${row.periodLabel}` })}
        >
          סימון כנפרע
        </Button>
      );
    }
    if (!pending && row.owed > 0.5) {
      return (
        <Button
          type="button"
          size="sm"
          className={ROW_BUTTON}
          variant={lateThisMonth(row, today) > 0.5 ? "default" : "outline"}
          onClick={() => openPayment(row)}
        >
          רישום תשלום
        </Button>
      );
    }
    if (row.debt.amount > 0.5 && row.debt.oldest) {
      return (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={ROW_BUTTON}
          onClick={() => openPayment(row, row.debt.oldest as string)}
        >
          רישום תשלום
        </Button>
      );
    }
    return null;
  }

  /**
   * The month's ways, at the end of its details: its check cleared, or the month paid another way — as plain
   * buttons — and in a quiet ⋮ the rest: "it came back" (owner, 2026-10-22: "why is that button red — it
   * looks like the check was already חזר even though it didn't"), the property's page and its checks. A check
   * that came back or was torn: its way back. What the row's own button already does isn't repeated here.
   */
  function otherActions(row: RentRollRow): ReactNode {
    const pending = row.payments.find((p) => p.method === "check" && p.paymentStatus === "pending") ?? null;
    const due = pending !== null && (pending.dueDate ?? pending.date ?? "") <= today;
    const canBounce = row.payments.filter((p) => p.method === "check");
    const title = `שכירות ${row.periodLabel}`;
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {pending && !due ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={ROW_BUTTON}
            onClick={() => setArrival({ payment: pending, title })}
          >
            סימון כנפרע
          </Button>
        ) : null}
        {/* Any money that came — this month or more, ahead or back; a waiting check of a month it pays is torn. Not
            when the row's own button is just that. */}
        {pending || row.owed <= 0.5 ? (
          <Button type="button" size="sm" variant="outline" className={ROW_BUTTON} onClick={() => openPayment(row)}>
            רישום תשלום
          </Button>
        ) : null}
        {row.returned.map((check) => (
          <Button
            key={`back-${check.id}`}
            type="button"
            size="sm"
            variant="outline"
            className={ROW_BUTTON}
            onClick={() => setBounced(check, false)}
          >
            ביטול: {checkName(check)} לא חזר
          </Button>
        ))}
        {row.torn.map((check) => (
          <Button
            key={`untear-${check.id}`}
            type="button"
            size="sm"
            variant="outline"
            className={ROW_BUTTON}
            onClick={() => setBounced(check, false)}
          >
            שחזור {checkName(check)}
          </Button>
        ))}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
              aria-label="עוד פעולות"
            >
              <MoreIcon className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {canBounce.map((check) => (
              <DropdownMenuItem key={check.id} onClick={() => setBounced(check, true)}>
                סימון {checkName(check)} כחוזר
              </DropdownMenuItem>
            ))}
            {canBounce.length > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem asChild>
              <Link href={`/properties/${row.property.id}#rent`}>לדף הנכס</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={rentChecksHref(row.property.id)}>הצ׳קים של הנכס</Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  }

  /** The month's state in words, beside its chip: when, how much is missing, how late. */
  function stateNote(row: RentRollRow): string | null {
    const late = lateThisMonth(row, today);
    if (row.returned.length > 0 && row.owed > 0.5) return `${checkName(row.returned[0])} חזר`;
    if (row.status.state === "partial") return `חסר ${formatCurrency(row.owed)}`;
    if (late > 0.5) return `${daysBetween(row.period, today)} ימים`;
    if (row.status.state === "check") {
      const check = row.payments.find((p) => p.method === "check" && p.paymentStatus === "pending");
      return check ? `לפירעון ${moneyDate(check)}` : null;
    }
    if (row.status.state === "upcoming") return `ב-${row.dueLabel}`;
    if (row.status.state === "paid") {
      const last = row.payments[row.payments.length - 1];
      return last ? moneyDate(last) : null;
    }
    return null;
  }

  const stateChip = (row: RentRollRow) => {
    const late = lateThisMonth(row, today) > 0.5;
    const state = RENT_STATE[row.status.state];
    const label =
      row.returned.length > 0 && row.owed > 0.5 ? "צ׳ק חזר" : late && row.status.state !== "partial" ? "באיחור" : state.label;
    return <Badge variant={late || row.returned.length > 0 ? "destructive" : state.badge}>{label}</Badge>;
  };

  const checksInHand = (row: RentRollRow): ReactNode => {
    const hand = row.checksInHand;
    if (hand.count === 0) return <span className="text-muted-foreground">—</span>;
    const soon = hand.lastPeriod !== null && daysBetween(today, hand.lastPeriod) <= SOON_DAYS;
    return (
      <span
        className={soon ? "font-medium text-warning-strong" : undefined}
        title={`${hand.count} צ׳קים · ${formatCurrency(hand.amount)}`}
      >
        {hand.count} · עד {hand.lastLabel?.replace(/ (תש\S*|\d{4})$/, "")}
      </span>
    );
  };
  const leaseEnd = (row: RentRollRow): ReactNode => {
    const end = row.lease.endDate?.slice(0, 10);
    if (!end) return <span className="text-muted-foreground">—</span>;
    const days = daysBetween(today, end);
    return <span className={days <= 90 ? "font-medium text-warning-strong" : undefined}>{formatShortDate(end)}</span>;
  };
  const debtCell = (row: RentRollRow): ReactNode => {
    if (row.debt.amount <= 0.5) return <span className="text-muted-foreground">—</span>;
    return (
      <span className="font-medium tabular-nums text-destructive" title={debtAge(row.debt).title}>
        {formatCurrency(row.debt.amount)}
      </span>
    );
  };

  /**
   * A row's details, opened under it — only what the row doesn't already say (owner, 2026-10-22: "it's just
   * a mush of words and rows"): a few labelled facts — the month's payment (the check's number and photo),
   * the account it goes into, the deposit — side by side, and the month's ways at the end of the same line.
   * Several payments: one line each, the payment's line and its account's level. A check that came back: red;
   * one torn: struck through, grey.
   */
  const details = (row: RentRollRow) => {
    const lines = [...row.payments, ...row.returned, ...row.torn];
    const several = lines.length > 1;
    const gone = (p: RentRollPayment) => p.paymentStatus === "rejected";
    return (
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div className="flex flex-wrap gap-x-8 gap-y-2">
          <DetailFact label={several ? "תשלומים" : "תשלום"}>
            {lines.length === 0 ? <span className="text-muted-foreground">לא נרשם</span> : null}
            {lines.map((p) => (
              <div
                key={p.id}
                className={cn(
                  "flex min-h-6 flex-wrap items-center gap-x-1.5",
                  p.tornAt ? "text-muted-foreground" : gone(p) ? "text-destructive" : undefined,
                )}
              >
                <span className={cn("font-medium", p.tornAt && "line-through")}>{methodWord(p)}</span>
                {several || p.rentPeriods > 1 ? (
                  <span
                    className={cn("tabular-nums", p.tornAt && "line-through")}
                    title={p.rentPeriods > 1 ? (paymentPeriodLabel(row.lease, toRollRent(p)) ?? undefined) : undefined}
                  >
                    {formatCurrency(paidTowards(row.lease, toRollRent(p), row.period))}
                    {p.rentPeriods > 1 ? ` מתוך ${formatCurrency(p.amount)}` : ""}
                  </span>
                ) : null}
                {p.tornAt ? <span>· נקרע {formatShortDate(p.tornAt)}</span> : gone(p) ? <span>· חזר</span> : null}
                <PaymentFiles payment={p} files={files[p.id]} />
              </div>
            ))}
          </DetailFact>
          {lines.length > 0 ? (
            <DetailFact label="חשבון">
              {lines.map((p) => (
                <div key={p.id} className={cn("flex min-h-6 items-center", gone(p) && "text-muted-foreground")}>
                  {accountName(p.accountId)}
                </div>
              ))}
            </DetailFact>
          ) : null}
          <DetailFact label="פיקדון">
            <div className="flex min-h-6 items-center">{deposit(row) || "—"}</div>
          </DetailFact>
        </div>
        {otherActions(row)}
      </div>
    );
  };

  const sheet = () => (tab === "year" && year ? yearSheet(year) : monthSheet(month, data.accountNames));

  // The filter toggle's look (blue when on, × to clear), sized for a table header.
  // The debt column's header is the filter itself (owner, 2026-10-22: "make the column header clickable to
  // filter"): a tap shows only who owes, the header blue with its × while it's on; a tap again shows everyone.
  const owingHeader = (
    <button
      type="button"
      aria-pressed={owingOnly}
      title={owingOnly ? "הצגת כולם" : "רק מי שחייב"}
      onClick={() => setOwingOnly((v) => !v)}
      className={cn(
        "-mx-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium transition-colors",
        owingOnly ? cn(TOGGLE_ON, TOGGLE_ON_HOVER) : "hover:bg-accent/60 hover:text-foreground",
      )}
    >
      <FilterIcon className="h-3.5 w-3.5" />
      חוב ישן
      {owingOnly ? (
        <span aria-hidden className="text-xs leading-none opacity-80">
          ×
        </span>
      ) : null}
    </button>
  );
  // A phone has no column headers: the same toggle, in words, heads its list.
  const owingChip = (
    <button
      type="button"
      aria-pressed={owingOnly}
      onClick={() => setOwingOnly((v) => !v)}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1 rounded-md border px-2 text-xs font-semibold transition-colors",
        owingOnly
          ? cn("border-secondary", TOGGLE_ON, TOGGLE_ON_HOVER)
          : "border-input bg-background text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      <FilterIcon className="h-3.5 w-3.5" />
      {owing.length > 0 ? `רק מי שחייב (${owing.length})` : "רק מי שחייב"}
      {owingOnly ? (
        <span aria-hidden className="text-xs leading-none opacity-80">
          ×
        </span>
      ) : null}
    </button>
  );

  return (
    <PageStack>
      {/* The app's underline tabs, close under the top bar (owner, 2026-10-22: "move the tabs higher … too much
          white space on top"); the tab row only switches tabs ("the row of the tab is to switch to a different tab"). */}
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value === "year" ? "year" : "month")}
        className="-mt-2 md:-mt-4 lg:-mt-6"
      >
        <TabsList variant="underline">
          <TabsTrigger value="month">
            <ChecklistIcon className="h-4 w-4" />
            חודש
          </TabsTrigger>
          <TabsTrigger value="year">
            <CalendarIcon className="h-4 w-4" />
            לוח שנתי
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Inside the tab, one row: the month (the year: its twelve) with the app's month stepper (צפי תזרים's
          ‹ › היום) around each lease's own month; on the month, who owes and what needs handling; and out to
          Excel / paper. */}
      <div className="relative flex flex-wrap items-center gap-2">
        <MonthStepper
          label={
            <h2 className="whitespace-nowrap">
              {tab === "year" && year ? `${year.headers[0]} – ${year.headers[year.headers.length - 1]}` : month.label}
            </h2>
          }
          onStep={(delta) => setOffset((n) => n + delta)}
          onToday={() => setOffset(0)}
          onCurrent={offset === 0}
        />
        {tab === "month" && offset === 0 && todo.length > 0 ? (
          <ToDoToggle count={todo.length} open={todoOpen} onToggle={() => setTodoOpen((v) => !v)} />
        ) : null}
        {tab === "month" && offset === 0 && todoOpen && todo.length > 0 ? (
          <>
            <button
              type="button"
              aria-label="סגירה"
              className="fixed inset-0 z-30 bg-black/30"
              onClick={() => setTodoOpen(false)}
            />
            <ToDoList
              todo={todo}
              today={today}
              onClose={() => setTodoOpen(false)}
              onPay={(row, period) => {
                setTodoOpen(false);
                openPayment(row, period);
              }}
            />
          </>
        ) : null}
        <div className="ms-auto flex items-center gap-1.5">
          <IconButton
            icon={DownloadIcon}
            label="ייצוא לאקסל"
            variant="outline"
            onClick={() => void downloadExcel(sheet()).catch(() => toast.error("ההורדה נכשלה."))}
          />
          <IconButton
            icon={PrintIcon}
            label="הדפסה"
            variant="outline"
            onClick={() => {
              if (!printSheet(sheet())) toast.error("הדפדפן חסם את חלון ההדפסה.");
            }}
          />
        </div>
      </div>

      {tab === "year" && year ? (
        <YearTable
          year={year}
          today={today}
          owedNow={new Map(now.rows.map((r) => [r.key, r.debt.amount + lateThisMonth(r, today)]))}
          onCell={(row) => {
            const pending = row.payments.find((p) => p.method === "check" && p.paymentStatus === "pending");
            if (!pending && row.owed > 0.5 && row.period <= today) openPayment(row);
            else setCell(row);
          }}
        />
      ) : (
        <>
          {/* Four plain figures — the month shown's collected and late, and today's checks — the checks ones open the checks page, filtered to rent. */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile
              label={offset === 0 ? "נגבה החודש" : "נגבה בחודש הזה"}
              value={formatCurrency(tiles.collected.amount)}
              tone={
                tiles.collected.expected > 0 && tiles.collected.amount >= tiles.collected.expected - 0.5 ? "success" : undefined
              }
              progress={tiles.collected.expected > 0 ? tiles.collected.amount / tiles.collected.expected : null}
              lines={[
                `מתוך ${formatCurrency(tiles.collected.expected)} · ${tiles.collected.paid} מתוך ${tiles.collected.tenants} שילמו`,
                tiles.collected.waitingChecks > 0.5
                  ? `ועוד ${formatCurrency(tiles.collected.waitingChecks)} בצ׳קים לחודש הזה`
                  : null,
              ]}
            />
            <Tile
              label="באיחור"
              value={formatCurrency(tiles.late.amount)}
              tone={tiles.late.amount > 0.5 ? "danger" : undefined}
              lines={
                tiles.late.amount > 0.5
                  ? [
                      tiles.late.tenants === 1 ? "שוכר אחד" : `${tiles.late.tenants} שוכרים`,
                      [
                        tiles.late.upTo30 > 0.5 ? `עד 30 יום ${formatCurrency(tiles.late.upTo30)}` : null,
                        tiles.late.upTo60 > 0.5 ? `31–60 יום ${formatCurrency(tiles.late.upTo60)}` : null,
                        tiles.late.over60 > 0.5 ? `מעל 60 יום ${formatCurrency(tiles.late.over60)}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · "),
                    ]
                  : ["אף אחד לא באיחור"]
              }
            />
            <Tile
              label="צ׳קים להפקדה"
              value={
                tiles.deposit.count === 0 ? "אין השבוע" : tiles.deposit.count === 1 ? "צ׳ק אחד" : `${tiles.deposit.count} צ׳קים`
              }
              tone={tiles.deposit.overdue > 0 ? "warning" : undefined}
              lines={
                tiles.deposit.count === 0
                  ? [tiles.deposit.next ? `הבא ב-${formatShortDate(tiles.deposit.next)}` : "אין צ׳קים ממתינים"]
                  : [
                      formatCurrency(tiles.deposit.amount),
                      tiles.deposit.overdue > 0 ? `${tiles.deposit.overdue} הגיע זמנם להפקדה` : "השבוע",
                    ]
              }
              href={rentChecksHref(undefined, "week")}
            />
            <Tile
              label="צ׳קים ביד"
              value={tiles.inHand.count === 1 ? "צ׳ק אחד" : `${tiles.inHand.count} צ׳קים`}
              lines={[
                tiles.inHand.count > 0 ? `${formatCurrency(tiles.inHand.amount)} שעוד לא הופקדו` : "אין צ׳קים ביד",
                tiles.inHand.firstOut
                  ? `נגמרים ראשונים: ${placeName(tiles.inHand.firstOut.row)}, ב${tiles.inHand.firstOut.label.replace(/ (תש\S*|\d{4})$/, "")}`
                  : null,
              ]}
              href={rentChecksHref()}
            />
          </div>

          {month.rows.length === 0 ? (
            <Card>
              <CardContent className="p-4">
                <EmptyState dense>אין שכירות לחודש הזה.</EmptyState>
              </CardContent>
            </Card>
          ) : (
            <ResponsiveDataView
              breakpoint="lg"
              desktop={
                <DataTableShell
                  maxHeight="none"
                  tbodyClassName=""
                  tableClassName="text-[0.8125rem]"
                  header={["נכס", "שוכר", "שכירות", "החודש", "חוב ישן", "צ׳קים ביד", "חוזה עד", ""].map((head, i) => (
                    <th key={i} scope="col" className={cn(HEAD_CELL, i === 0 && cn(STICKY, "bg-muted"))}>
                      {i === 4 ? owingHeader : head || <span className="sr-only">פעולות</span>}
                    </th>
                  ))}
                >
                  {/* Filtered to nobody: said inside the table, its header (and the filter's toggle) staying. */}
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-4">
                        <EmptyState dense>אף אחד לא חייב.</EmptyState>
                      </td>
                    </tr>
                  ) : null}
                  {rows.map((row) => {
                    const isOpen = open === row.key;
                    const note = stateNote(row);
                    return (
                      <Fragment key={row.key}>
                        <tr
                          id={`lease-${row.key}`}
                          className={cn(
                            "scroll-mt-24 cursor-pointer border-b border-border/50 align-middle hover:bg-muted/20",
                            isOpen && "bg-muted/20",
                          )}
                          onClick={() => setOpen(isOpen ? null : row.key)}
                        >
                          <td className={cn(CELL, STICKY, "whitespace-nowrap")}>
                            <span className="flex items-center gap-1">
                              <ChevronDownIcon
                                className={cn(
                                  "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                                  isOpen && "rotate-180",
                                )}
                              />
                              <Link
                                href={`/properties/${row.property.id}#rent`}
                                className="font-medium hover:underline"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {placeName(row)}
                              </Link>
                            </span>
                          </td>
                          <td className={cn(CELL, "whitespace-nowrap")}>{row.lease.customerName ?? "—"}</td>
                          <td className={cn(CELL, "whitespace-nowrap tabular-nums")}>{formatCurrency(row.status.rent)}</td>
                          <td className={cn(CELL, "whitespace-nowrap")}>
                            <span className="inline-flex items-center gap-1.5">
                              {stateChip(row)}
                              {note ? <span className="text-xs text-muted-foreground">{note}</span> : null}
                            </span>
                          </td>
                          <td className={cn(CELL, "whitespace-nowrap")}>{debtCell(row)}</td>
                          <td className={cn(CELL, "whitespace-nowrap")}>{checksInHand(row)}</td>
                          <td className={cn(CELL, "whitespace-nowrap")}>{leaseEnd(row)}</td>
                          <td className={cn(CELL, "py-1")} onClick={(e) => e.stopPropagation()}>
                            <div className="flex justify-end">{mainAction(row)}</div>
                          </td>
                        </tr>
                        {isOpen ? (
                          <tr className="border-b border-border/50 bg-muted/20">
                            <td colSpan={8} className="px-3 pb-3 pt-1">
                              {details(row)}
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </DataTableShell>
              }
              mobile={
                <Card>
                  {/* A phone has no column header: "who owes" heads the list. */}
                  <div className="flex items-center justify-end border-b border-border/60 px-3 py-1.5">{owingChip}</div>
                  {rows.length === 0 ? (
                    <div className="p-4">
                      <EmptyState dense>אף אחד לא חייב.</EmptyState>
                    </div>
                  ) : null}
                  <ul className="divide-y">
                    {rows.map((row) => {
                      const isOpen = open === row.key;
                      const note = stateNote(row);
                      const action = mainAction(row);
                      return (
                        <li key={row.key} id={`lease-m-${row.key}`} className="scroll-mt-24 px-3 py-2">
                          <button
                            type="button"
                            className="block w-full text-start"
                            onClick={() => setOpen(isOpen ? null : row.key)}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 text-sm">
                                <span className="font-medium">{placeName(row)}</span>
                                <span className="text-muted-foreground"> · {row.lease.customerName ?? "שוכר"}</span>
                              </div>
                              <span className="shrink-0 text-sm font-semibold tabular-nums">
                                {formatCurrency(row.status.rent)}
                              </span>
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                              {stateChip(row)}
                              {note ? <span>{note}</span> : null}
                              {row.debt.amount > 0.5 ? (
                                <span className="text-destructive">חוב ישן {formatCurrency(row.debt.amount)}</span>
                              ) : null}
                              {row.checksInHand.count > 0 ? <span>צ׳קים ביד {checksInHand(row)}</span> : null}
                            </div>
                          </button>
                          {action ? <div className="mt-1.5 flex">{action}</div> : null}
                          {isOpen ? <div className="mt-2 rounded-lg bg-muted/30 p-2">{details(row)}</div> : null}
                        </li>
                      );
                    })}
                  </ul>
                </Card>
              }
            />
          )}
        </>
      )}

      {/* A year cell's month: what paid it and its ways. */}
      <ViewDialog
        open={cell !== null}
        onOpenChange={(next) => (next ? undefined : setCell(null))}
        title={cell ? `${placeName(cell)} · ${cell.periodLabel}` : ""}
        description={
          cell
            ? `${cell.lease.customerName ?? ""} · ${formatCurrency(cell.status.rent)} · ${RENT_STATE[cell.status.state].label}`
            : undefined
        }
        size="formMd"
      >
        {cell ? (
          <div className="space-y-3">
            {details(cell)}
            {mainAction(cell)}
          </div>
        ) : null}
      </ViewDialog>

      <PropertyRentPaymentDialog
        open={payingOpen}
        onOpenChange={setPayingOpen}
        propertyId={paying?.row.property.id ?? ""}
        lease={paying?.row.lease ?? null}
        payments={payingPayments}
        prefill={paying ? { periodStart: paying.period, method: usual?.method, accountId: usual?.accountId } : undefined}
        onRecorded={paying ? remember(paying.row.property.id) : undefined}
        onUndone={(id) => setRecorded((prev) => prev.filter((p) => p.id !== id))}
        onCheckCleared={(check) =>
          setArrival({
            payment: check,
            title: `שכירות ${paying && check.rentPeriodStart ? rentPeriodLabel(paying.row.lease, check.rentPeriodStart) : (paying?.row.periodLabel ?? "")}`,
          })
        }
      />
      <PropertyCheckArrivedDialog
        payment={arrival?.payment ?? null}
        title={arrival?.title ?? ""}
        onClose={() => setArrival(null)}
      />
    </PageStack>
  );
}

/** "מה לעשות" — what needs doing now, each line with its one button; it folds to its title (the owner: "able to close"). */
/** The name of what needs handling (owner, 2026-10-22: "לטיפול"). */
export const TODO_TITLE = "לטיפול";

/** Its button in the row under the tabs, the filter chip's size: the name, how many, open or not. */
function ToDoToggle({ count, open, onToggle }: { count: number; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 px-3 text-xs font-semibold transition-colors",
        TOOLBAR_CONTROL,
        open
          ? cn("border-secondary", TOGGLE_ON, TOGGLE_ON_HOVER)
          : "border-input bg-background text-foreground hover:bg-accent/60",
      )}
    >
      <ChecklistIcon className="h-3.5 w-3.5" />
      {TODO_TITLE}
      <CountBadge
        count={count}
        className={open ? "bg-secondary-foreground/20 text-secondary-foreground" : "bg-destructive text-destructive-foreground"}
      />
      <ChevronDownIcon className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
    </button>
  );
}

/** What needs handling now, each line with its one button — a panel over the page, under its button's row. */
function ToDoList({
  todo,
  today,
  onPay,
  onClose,
}: {
  todo: RentToDo[];
  today: string;
  onPay: (row: RentRollRow, period?: string) => void;
  onClose: () => void;
}) {
  const line = (key: string, tone: "danger" | "warning" | "muted", label: string, text: ReactNode, action: ReactNode) => (
    <li key={key} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1.5">
      <span className="min-w-0 text-sm">
        <span
          className={cn(
            "font-medium",
            tone === "danger" && "text-destructive",
            tone === "warning" && "text-warning-strong",
            tone === "muted" && "text-muted-foreground",
          )}
        >
          {label}
        </span>
        <span className="text-muted-foreground"> · </span>
        {text}
      </span>
      <span className="flex shrink-0 items-center gap-1.5">{action}</span>
    </li>
  );
  const who = (row: RentRollRow) => `${placeName(row)} · ${row.lease.customerName ?? "שוכר"}`;
  const pay = (row: RentRollRow, period?: string, main = false) => (
    <Button
      type="button"
      size="sm"
      variant={main ? "default" : "outline"}
      className={ROW_BUTTON}
      onClick={() => onPay(row, period)}
    >
      רישום תשלום
    </Button>
  );

  return (
    <div
      role="dialog"
      aria-label={TODO_TITLE}
      className="absolute inset-x-0 top-full z-40 mt-2 max-h-[70vh] overflow-y-auto rounded-xl border border-border/60 bg-card p-3 shadow-lg lg:max-w-3xl"
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-medium">
          <ChecklistIcon className="h-4 w-4 text-muted-foreground" />
          {TODO_TITLE}
        </span>
        <button
          type="button"
          aria-label="סגירה"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
          onClick={onClose}
        >
          <CloseIcon className="h-4 w-4" />
        </button>
      </div>
      <ul className="divide-y">
        {todo.map((item, i) => {
          switch (item.kind) {
            case "bounced":
              return line(
                `b${i}`,
                "danger",
                "צ׳ק חזר",
                `${who(item.row)} · ${checkName(item.check)} · ${formatCurrency(item.check.amount)} — לבקש צ׳ק אחר או תשלום`,
                pay(item.row, undefined, true),
              );
            case "late":
              return line(
                `l${i}`,
                "danger",
                "באיחור",
                `${who(item.row)} · ${formatCurrency(lateThisMonth(item.row, today))} · ${item.days} ימים (${item.row.periodLabel})`,
                pay(item.row, undefined, true),
              );
            case "deposit": {
              const dueSum = item.due.reduce((s, p) => s + p.amount, 0);
              const weekSum = item.week.reduce((s, p) => s + p.amount, 0);
              return line(
                `d${i}`,
                item.due.length > 0 ? "warning" : "muted",
                "צ׳קים להפקדה",
                [
                  item.due.length > 0 ? `${item.due.length} הגיע זמנם · ${formatCurrency(dueSum)}` : null,
                  item.week.length > 0 ? `השבוע ${item.week.length} · ${formatCurrency(weekSum)}` : null,
                ]
                  .filter(Boolean)
                  .join(" · "),
                <Button asChild size="sm" variant="outline" className={ROW_BUTTON}>
                  <Link href={rentChecksHref(undefined, "week")}>לצ׳קים</Link>
                </Button>,
              );
            }
            case "debt":
              return line(
                `o${i}`,
                "danger",
                "חוב ישן",
                `${who(item.row)} · ${formatCurrency(item.row.debt.amount)} · ${debtWords(item.row.debt)}`,
                item.row.debt.oldest ? pay(item.row, item.row.debt.oldest) : null,
              );
            case "checksLow": {
              const hand = item.row.checksInHand;
              const text = hand.count === 0 ? "אין צ׳קים ביד" : `נשארו ${hand.count}, עד ${hand.lastLabel}`;
              const href = whatsappHref(
                item.row.lease.customerPhone,
                `שלום ${item.row.lease.customerName ?? ""}, הצ׳קים לשכירות ב${placeName(item.row)} ${hand.count === 0 ? "נגמרו" : `נגמרים ב${hand.lastLabel}`}. אפשר להעביר את הצ׳קים הבאים?`,
              );
              return line(
                `c${i}`,
                "warning",
                "צ׳קים נגמרים",
                `${who(item.row)} · ${text} — לבקש צ׳קים חדשים`,
                href ? (
                  <Button asChild size="sm" variant="outline" className={cn(ROW_BUTTON, "gap-1")}>
                    <a href={href} target="_blank" rel="noreferrer">
                      <ChatIcon className="h-3.5 w-3.5" />
                      וואטסאפ
                    </a>
                  </Button>
                ) : null,
              );
            }
            case "leaseEnd":
              return line(
                `e${i}`,
                "warning",
                "חוזה מסתיים",
                `${who(item.row)} · ${formatShortDate(item.row.lease.endDate)} (עוד ${item.days} ימים) — לחדש או להודיע`,
                <Button asChild size="sm" variant="outline" className={ROW_BUTTON}>
                  <Link href={`/properties/${item.row.property.id}#tenant`}>לחוזה</Link>
                </Button>,
              );
            case "vacant":
              return line(
                `v${i}`,
                "muted",
                "בלי שוכר",
                item.properties.map((p) => propertyDisplayName(p)).join(" · "),
                <Button asChild size="sm" variant="outline" className={ROW_BUTTON}>
                  <Link href="/properties">לנכסים</Link>
                </Button>,
              );
          }
        })}
      </ul>
    </div>
  );
}

/** One plain figure, on a Card: what it is, its value, a line or two saying what's in it; a link when it opens a page. */
function Tile({
  label,
  value,
  lines,
  tone,
  progress,
  href,
}: {
  label: string;
  value: string;
  lines: (string | null)[];
  tone?: "success" | "danger" | "warning";
  progress?: number | null;
  href?: string;
}) {
  const body = (
    <CardContent className="p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-0.5 text-lg font-semibold tabular-nums",
          tone === "success" && "text-success",
          tone === "danger" && "text-destructive",
          tone === "warning" && "text-warning-strong",
        )}
      >
        {value}
      </div>
      {progress != null ? (
        <div className="my-1 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-success"
            style={{ width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%` }}
          />
        </div>
      ) : null}
      {lines
        .filter((l): l is string => Boolean(l))
        .map((l) => (
          <div key={l} className="text-xs text-muted-foreground">
            {l}
          </div>
        ))}
    </CardContent>
  );
  if (href) {
    return (
      <Link href={href} className="block rounded-card">
        <Card className="h-full transition-colors hover:bg-muted/20">{body}</Card>
      </Link>
    );
  }
  return <Card className="h-full">{body}</Card>;
}

/** The year at a glance: each lease a row, each month a cell — the months ahead show the checks in hand — what it owes now, and each month's share collected. */
function YearTable({
  year,
  today,
  owedNow,
  onCell,
}: {
  year: RentRollYear;
  today: string;
  owedNow: Map<string, number>;
  onCell: (row: RentRollRow) => void;
}) {
  // A narrow screen scrolls the months sideways: it opens on this one, not on the oldest.
  const currentHead = useRef<HTMLTableCellElement>(null);
  useEffect(() => {
    currentHead.current?.scrollIntoView?.({ inline: "center", block: "nearest" });
  }, []);
  if (year.rows.length === 0) {
    return (
      <Card>
        <CardContent className="p-4">
          <EmptyState dense>אין שכירות בחודשים האלה.</EmptyState>
        </CardContent>
      </Card>
    );
  }
  const current = year.offsets.indexOf(0);
  return (
    <div className="space-y-2">
      <DataTableShell
        maxHeight="none"
        header={
          <>
            <th scope="col" className={cn(HEAD_CELL, STICKY, "bg-muted")}>
              נכס
            </th>
            <th scope="col" className={HEAD_CELL}>
              שוכר
            </th>
            {year.headers.map((head, i) => (
              <th
                key={i}
                ref={i === current ? currentHead : undefined}
                scope="col"
                className={cn(HEAD_CELL, "px-1 text-center", i === current && "bg-secondary/10 text-foreground")}
              >
                {head}
              </th>
            ))}
            <th scope="col" className={HEAD_CELL}>
              חייב
            </th>
          </>
        }
        tfoot={
          <tr className="border-t-2 border-border/70 bg-muted/30 text-xs font-semibold">
            <td className={cn(CELL, STICKY, "bg-muted")}>נגבה</td>
            <td />
            {year.rates.map((rate, i) => (
              <td key={i} className={cn(CELL, "px-1 text-center tabular-nums", i === current && "bg-secondary/10")}>
                {rate === null ? "—" : `${Math.round(rate * 100)}%`}
              </td>
            ))}
            <td />
          </tr>
        }
      >
        {year.rows.map((row) => {
          const owed = owedNow.get(row.key) ?? 0;
          return (
            <tr key={row.key} className="hover:bg-muted/20">
              <td className={cn(CELL, STICKY, "whitespace-nowrap")}>
                <Link href={`/properties/${row.property.id}#rent`} className="font-medium hover:underline">
                  {placeName(row)}
                </Link>
              </td>
              <td className={cn(CELL, "whitespace-nowrap")}>{row.lease.customerName ?? "—"}</td>
              {row.cells.map((cell, i) => {
                if (!cell) return <td key={i} className={cn(CELL, "px-1", i === current && "bg-secondary/5")} />;
                const ahead = cell.status.state === "check" && cell.period > today;
                const look = CELL_LOOK[cell.status.state];
                const words = [
                  `${cell.periodLabel}: ${ahead ? "צ׳ק ביד" : RENT_STATE[cell.status.state].label}`,
                  ...cell.payments.map((p) => `${formatCurrency(p.amount)} · ${moneyDate(p)} · ${methodWord(p)}`),
                  ...cell.returned.map((p) => `${checkName(p)} חזר`),
                ].join("\n");
                return (
                  <td key={i} className={cn(CELL, "px-1 text-center", i === current && "bg-secondary/5")}>
                    <button
                      type="button"
                      title={words}
                      aria-label={words}
                      onClick={() => onCell(cell)}
                      className={cn(
                        "inline-flex h-7 min-w-9 items-center justify-center rounded-full px-2 text-xs font-semibold transition-colors hover:ring-2 hover:ring-ring/30",
                        ahead ? AHEAD_CHECK : look.className,
                        cell.returned.length > 0 && "ring-2 ring-destructive/60",
                      )}
                    >
                      {look.mark}
                    </button>
                  </td>
                );
              })}
              <td className={cn(CELL, "whitespace-nowrap tabular-nums")}>
                {owed > 0.5 ? (
                  <span className="font-medium text-destructive">{formatCurrency(owed)}</span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
            </tr>
          );
        })}
      </DataTableShell>
      {/* What the marks mean. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {(["paid", "check", "partial", "late", "upcoming"] as const).map((state) => (
          <span key={state} className="inline-flex items-center gap-1">
            <span
              className={cn(
                "inline-flex h-5 min-w-6 items-center justify-center rounded-full px-1.5 font-semibold",
                CELL_LOOK[state].className,
              )}
            >
              {CELL_LOOK[state].mark}
            </span>
            {state === "check" ? "צ׳ק ממתין לפירעון" : RENT_STATE[state].label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1">
          <span
            className={cn("inline-flex h-5 min-w-6 items-center justify-center rounded-full px-1.5 font-semibold", AHEAD_CHECK)}
          >
            צ׳
          </span>
          צ׳ק ביד לחודש הבא
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-flex h-5 min-w-6 rounded-full ring-2 ring-destructive/60" />
          צ׳ק חזר
        </span>
      </div>
    </div>
  );
}

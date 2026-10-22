"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { DataTableShell } from "@/components/ui/data-table-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterChip } from "@/components/ui/filter-chip";
import { IconButton } from "@/components/ui/icon-button";
import { DocumentLink } from "@/components/ui/document-tile";
import { ResponsiveDataView } from "@/components/ui/responsive-data-view";
import { SECTION_ICON_CLASS, SectionCount } from "@/components/ui/section-card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ViewDialog } from "@/components/ui/view-dialog";
import {
  AttachIcon,
  CalendarIcon,
  ChatIcon,
  ChecklistIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  PrintIcon,
} from "@/components/ui/icons";
import { PageStack } from "@/components/layout/page-layout";
import { useUndoOverlay } from "@/hooks/useUndoOverlay";
import { CONNECTION_EVENTS } from "@/lib/offline-queue";
import { getUndoPatch, scheduleDeferredEdit } from "@/lib/undo-engine";
import { toHebrewError } from "@/lib/error-messages";
import { formatShortDate } from "@/lib/date";
import { formatCurrency } from "@/lib/payroll";
import { paymentMethodLabel } from "@/lib/orders/paymentStatus";
import { whatsappHref } from "@/lib/whatsapp";
import { STATUS_PILL_CLASSES } from "@/lib/ui/status-color-classes";
import type { FinancialAttachment } from "@/lib/payments";
import { propertyDisplayName, type PropertyPayment, type RentRollData, type RentRollPayment, type RentRollProperty } from "@/lib/properties";
import { RENT_STATE, type RentMonthState } from "@/lib/property-rent";
import {
  daysBetween,
  lateThisMonth,
  rentRollOffsetFor,
  rentRollToday,
  rentRollYear,
  rentRowOwes,
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
import PropertyPaidInsteadDialog from "@/app/(app)/properties/[id]/PropertyPaidInsteadDialog";
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

/**
 * "מה לעשות" starts folded (owner, 2026-10-22: "should start off closed") and
 * opens with a tap ("able to close", the day before); someone who opened it
 * finds it open — a cookie the server reads, so the page draws it right from
 * the start and nothing moves once it's on screen.
 */
export const RENT_TODO_COOKIE = "bizh-rent-todo";

/** The checks page, showing every property's rent checks (or one property's). */
const rentChecksHref = (propertyId?: string) => `/checks?property=${propertyId ?? "rent"}`;

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
  return formatShortDate(payment.method === "check" ? payment.dueDate ?? payment.date : payment.date, "—");
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

export default function RentRollClient({ data, todoClosed = true }: { data: RentRollData; todoClosed?: boolean }) {
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
  const [instead, setInstead] = useState<{ row: RentRollRow; payment: PropertyPayment; title: string } | null>(null);
  const [cell, setCell] = useState<RentRollRow | null>(null);
  function rememberTodo(isOpen: boolean) {
    document.cookie = isOpen
      ? `${RENT_TODO_COOKIE}=open; path=/; max-age=31536000; samesite=lax`
      : `${RENT_TODO_COOKIE}=; path=/; max-age=0; samesite=lax`;
  }

  // Checks marked cleared, moved on, bounced or edited here show so at once (their patches).
  const overlaid = useUndoOverlay(data.payments, paymentKey, "property-payment");
  const payments = useMemo(() => {
    const shown = recorded.filter((r) => {
      if (overlaid.some((p) => p.id === r.id || (p.id !== r.id.replace(/^instead:/, "") && sameRent(p, r)))) return false;
      // A month paid another way: only while its check's move stands (not undone).
      return r.id.startsWith("instead:") ? Boolean(getUndoPatch("property-payment", r.id.slice("instead:".length))) : true;
    });
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
    ? [...payments]
        .filter((p) => p.leaseId === paying.row.lease.id && p.paymentStatus !== "rejected")
        .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || b.id.localeCompare(a.id))[0] ?? null
    : null;
  const payingPayments = paying ? payments.filter((p) => p.propertyId === paying.row.property.id) : [];
  const insteadPayments = instead ? payments.filter((p) => p.propertyId === instead.row.property.id) : [];
  const accountName = (id: string | null) => (id ? data.accountNames[id] ?? "—" : "—");

  function openPayment(row: RentRollRow, period: string = row.period) {
    setPaying({ row, period });
    setPayingOpen(true);
  }

  /** A check that came back — or, undone, didn't: at once, with its undo; sent when the undo has passed. */
  function setBounced(payment: RentRollPayment, bounced: boolean) {
    scheduleDeferredEdit({
      scope: "property-payment",
      id: payment.id,
      message: bounced ? `${checkName(payment)} סומן כחוזר.` : `${checkName(payment)} חזר לממתין.`,
      patch: { paymentStatus: bounced ? "rejected" : "pending" },
      onCommit: async () => {
        const res = await fetch("/api/payments/mark-collected", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(bounced ? { id: payment.id, bounced: true } : { id: payment.id, collected: false }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) return { ok: false, error: toHebrewError(json?.error, "עדכון הצ׳ק נכשל.") };
        startTransition(() => router.refresh());
        return { ok: true };
      },
    });
  }

  /** The row's one main button, by where its rent stands. */
  function mainAction(row: RentRollRow): ReactNode {
    const pending = row.payments.find((p) => p.method === "check" && p.paymentStatus === "pending") ?? null;
    if (pending && (pending.dueDate ?? pending.date ?? "") <= today) {
      return (
        <Button type="button" size="sm" className={ROW_BUTTON} onClick={() => setArrival({ payment: pending, title: `שכירות ${row.periodLabel}` })}>
          נפרע
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
        <Button type="button" size="sm" variant="outline" className={ROW_BUTTON} onClick={() => openPayment(row, row.debt.oldest as string)}>
          רישום תשלום
        </Button>
      );
    }
    return null;
  }

  /** Everything else for a row's month: the check's ways, in its details. */
  function otherActions(row: RentRollRow): ReactNode {
    const pending = row.payments.find((p) => p.method === "check" && p.paymentStatus === "pending") ?? null;
    const cleared = row.payments.filter((p) => p.method === "check" && p.paymentStatus !== "pending");
    const title = `שכירות ${row.periodLabel}`;
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {pending ? (
          <>
            <Button type="button" size="sm" variant="outline" className={ROW_BUTTON} onClick={() => setArrival({ payment: pending, title })}>
              נפרע
            </Button>
            <Button type="button" size="sm" variant="outline" className={ROW_BUTTON} onClick={() => setInstead({ row, payment: pending, title })}>
              שולם אחרת החודש
            </Button>
          </>
        ) : null}
        {[...(pending ? [pending] : []), ...cleared].map((check) => (
          <Button
            key={`bounce-${check.id}`}
            type="button"
            size="sm"
            variant="destructive-outline"
            className={ROW_BUTTON}
            onClick={() => setBounced(check, true)}
          >
            {checkName(check)} חזר
          </Button>
        ))}
        {row.returned.map((check) => (
          <Button key={`back-${check.id}`} type="button" size="sm" variant="outline" className={ROW_BUTTON} onClick={() => setBounced(check, false)}>
            ביטול: {checkName(check)} לא חזר
          </Button>
        ))}
        {row.owed > 0.5 && pending ? (
          <Button type="button" size="sm" variant="outline" className={ROW_BUTTON} onClick={() => openPayment(row)}>
            רישום תשלום
          </Button>
        ) : null}
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
    const label = row.returned.length > 0 && row.owed > 0.5 ? "צ׳ק חזר" : late && row.status.state !== "partial" ? "באיחור" : state.label;
    return <Badge variant={late || row.returned.length > 0 ? "destructive" : state.badge}>{label}</Badge>;
  };

  const checksInHand = (row: RentRollRow): ReactNode => {
    const hand = row.checksInHand;
    if (hand.count === 0) return <span className="text-muted-foreground">—</span>;
    const soon = hand.lastPeriod !== null && daysBetween(today, hand.lastPeriod) <= SOON_DAYS;
    return (
      <span className={soon ? "font-medium text-warning-strong" : undefined} title={`${hand.count} צ׳קים · ${formatCurrency(hand.amount)}`}>
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

  /** A row's details, opened under it: the month's payments, its due day and deposit, links, the rest of its actions. */
  const details = (row: RentRollRow) => (
    <div className="space-y-2 text-xs">
      {row.payments.length === 0 && row.returned.length === 0 ? (
        <div className="text-muted-foreground">לא נרשם תשלום ל{row.periodLabel}.</div>
      ) : null}
      {row.payments.map((p) => (
        <div key={p.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className="tabular-nums"
            title={p.rentPeriods > 1 && p.rentPeriodStart ? rentPeriodLabel(row.lease, p.rentPeriodStart, p.rentPeriods) : undefined}
          >
            {formatCurrency(p.amount)}
            {p.rentPeriods > 1 ? ` (${p.rentPeriods} חודשים)` : ""}
          </span>
          <span className="text-muted-foreground">·</span>
          <span>{moneyDate(p)}</span>
          <span className="text-muted-foreground">·</span>
          <span>
            {methodWord(p)}
            {p.method === "check" && p.paymentStatus === "pending" ? " (ממתין)" : ""}
          </span>
          <span className="text-muted-foreground">·</span>
          <span>{accountName(p.accountId)}</span>
          <PaymentFiles payment={p} files={files[p.id]} />
        </div>
      ))}
      {row.returned.map((p) => (
        <div key={p.id} className="flex flex-wrap items-center gap-x-2 text-destructive">
          <span>
            {checkName(p)} חזר · {formatCurrency(p.amount)}
          </span>
          <PaymentFiles payment={p} files={files[p.id]} />
        </div>
      ))}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
        <span>מועד: {row.dueLabel}</span>
        {row.debt.amount > 0.5 ? (
          <span className="text-destructive" title={debtAge(row.debt).title}>
            חוב ישן: {formatCurrency(row.debt.amount)} · {debtWords(row.debt)}
          </span>
        ) : null}
        <span>פיקדון: {deposit(row) || "—"}</span>
        <Link href={`/properties/${row.property.id}#rent`} className="text-secondary hover:underline">
          לדף הנכס
        </Link>
        <Link href={rentChecksHref(row.property.id)} className="text-secondary hover:underline">
          הצ׳קים של הנכס
        </Link>
      </div>
      {otherActions(row)}
    </div>
  );

  const sheet = () => (tab === "year" && year ? yearSheet(year) : monthSheet(month, data.accountNames));

  return (
    <PageStack>
      {/* The app's underline tabs — a fixed-height bar that never moves. */}
      {/* One bar (owner, 2026-10-22: "there's wasted space here"): the app's
          underline tabs, the month shown (the year: which twelve months) — back,
          on, and back to this one — and out to Excel / paper, on the tabs' line. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/60">
        <Tabs value={tab} onValueChange={(value) => setTab(value === "year" ? "year" : "month")}>
          <TabsList variant="underline" className="w-auto border-b-0">
            <TabsTrigger value="month" count={todo.length > 0 ? todo.length : undefined}>
              <ChecklistIcon className="h-4 w-4" />
              חודש
            </TabsTrigger>
            <TabsTrigger value="year">
              <CalendarIcon className="h-4 w-4" />
              לוח שנתי
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-1.5 pb-1">
          <Button type="button" variant="outline" size="icon-sm" aria-label="החודש הקודם" onClick={() => setOffset((n) => n - 1)}>
            <ChevronRightIcon className="h-4 w-4" />
          </Button>
          <h2 className="whitespace-nowrap text-sm font-semibold">
            {tab === "year" && year ? `${year.headers[0]} – ${year.headers[year.headers.length - 1]}` : month.label}
          </h2>
          <Button type="button" variant="outline" size="icon-sm" aria-label="החודש הבא" onClick={() => setOffset((n) => n + 1)}>
            <ChevronLeftIcon className="h-4 w-4" />
          </Button>
          {offset !== 0 ? (
            <Button type="button" variant="ghost" size="sm" className="text-secondary" onClick={() => setOffset(0)}>
              לחודש הזה
            </Button>
          ) : null}
        </div>
        <div className="ms-auto flex items-center gap-1.5 pb-1">
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
          {/* What to do is about now — shown on this month only. */}
          {offset === 0 ? (
            <ToDoSection todo={todo} today={today} onPay={openPayment} defaultOpen={!todoClosed} onOpenChange={rememberTodo} />
          ) : null}

          {/* Four plain figures — the month shown's collected and late, and today's checks — the checks ones open the checks page, filtered to rent. */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile
              label={offset === 0 ? "נגבה החודש" : "נגבה בחודש הזה"}
              value={formatCurrency(tiles.collected.amount)}
              tone={tiles.collected.expected > 0 && tiles.collected.amount >= tiles.collected.expected - 0.5 ? "success" : undefined}
              progress={tiles.collected.expected > 0 ? tiles.collected.amount / tiles.collected.expected : null}
              lines={[
                `מתוך ${formatCurrency(tiles.collected.expected)} · ${tiles.collected.paid} מתוך ${tiles.collected.tenants} שילמו`,
                tiles.collected.waitingChecks > 0.5 ? `ועוד ${formatCurrency(tiles.collected.waitingChecks)} בצ׳קים לחודש הזה` : null,
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
              value={tiles.deposit.count === 0 ? "אין השבוע" : tiles.deposit.count === 1 ? "צ׳ק אחד" : `${tiles.deposit.count} צ׳קים`}
              tone={tiles.deposit.overdue > 0 ? "warning" : undefined}
              lines={
                tiles.deposit.count === 0
                  ? [tiles.deposit.next ? `הבא ב-${formatShortDate(tiles.deposit.next)}` : "אין צ׳קים ממתינים"]
                  : [formatCurrency(tiles.deposit.amount), tiles.deposit.overdue > 0 ? `${tiles.deposit.overdue} הגיע זמנם להפקדה` : "השבוע"]
              }
              href={rentChecksHref()}
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

          <div className="flex flex-wrap items-center gap-2">
            <FilterChip
              active={owingOnly}
              label={owing.length > 0 ? `רק מי שחייב (${owing.length})` : "רק מי שחייב"}
              onClick={() => setOwingOnly((v) => !v)}
            />
          </div>

          {rows.length === 0 ? (
            <Card>
              <CardContent className="p-4">
                <EmptyState dense>{month.rows.length === 0 ? "אין שכירות לחודש הזה." : "אף אחד לא חייב."}</EmptyState>
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
                      {head || <span className="sr-only">פעולות</span>}
                    </th>
                  ))}
                >
                  {rows.map((row) => {
                    const isOpen = open === row.key;
                    const note = stateNote(row);
                    return (
                      <Fragment key={row.key}>
                        <tr
                          id={`lease-${row.key}`}
                          className={cn("scroll-mt-24 cursor-pointer border-b border-border/50 align-middle hover:bg-muted/20", isOpen && "bg-muted/20")}
                          onClick={() => setOpen(isOpen ? null : row.key)}
                        >
                          <td className={cn(CELL, STICKY, "whitespace-nowrap")}>
                            <span className="flex items-center gap-1">
                              <ChevronDownIcon
                                className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")}
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
                  <ul className="divide-y">
                    {rows.map((row) => {
                      const isOpen = open === row.key;
                      const note = stateNote(row);
                      const action = mainAction(row);
                      return (
                        <li key={row.key} id={`lease-m-${row.key}`} className="scroll-mt-24 px-3 py-2">
                          <button type="button" className="block w-full text-start" onClick={() => setOpen(isOpen ? null : row.key)}>
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 text-sm">
                                <span className="font-medium">{placeName(row)}</span>
                                <span className="text-muted-foreground"> · {row.lease.customerName ?? "שוכר"}</span>
                              </div>
                              <span className="shrink-0 text-sm font-semibold tabular-nums">{formatCurrency(row.status.rent)}</span>
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                              {stateChip(row)}
                              {note ? <span>{note}</span> : null}
                              {row.debt.amount > 0.5 ? <span className="text-destructive">חוב ישן {formatCurrency(row.debt.amount)}</span> : null}
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
        description={cell ? `${cell.lease.customerName ?? ""} · ${formatCurrency(cell.status.rent)} · ${RENT_STATE[cell.status.state].label}` : undefined}
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
      />
      <PropertyCheckArrivedDialog payment={arrival?.payment ?? null} title={arrival?.title ?? ""} onClose={() => setArrival(null)} />
      <PropertyPaidInsteadDialog
        check={instead?.payment ?? null}
        lease={instead?.row.lease ?? null}
        payments={insteadPayments}
        propertyId={instead?.row.property.id ?? ""}
        title={instead?.title ?? ""}
        onClose={() => setInstead(null)}
        onRecorded={instead ? remember(instead.row.property.id) : undefined}
      />
    </PageStack>
  );
}

/** "מה לעשות" — what needs doing now, each line with its one button; it folds to its title (the owner: "able to close"). */
function ToDoSection({
  todo,
  today,
  onPay,
  defaultOpen,
  onOpenChange,
}: {
  todo: RentToDo[];
  today: string;
  onPay: (row: RentRollRow, period?: string) => void;
  defaultOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const line = (key: string, tone: "danger" | "warning" | "muted", label: string, text: ReactNode, action: ReactNode) => (
    <li key={key} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1.5">
      <span className="min-w-0 text-sm">
        <span
          className={cn(
            "font-medium",
            tone === "danger" && "text-destructive",
            tone === "warning" && "text-warning-strong",
            tone === "muted" && "text-muted-foreground"
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
    <Button type="button" size="sm" variant={main ? "default" : "outline"} className={ROW_BUTTON} onClick={() => onPay(row, period)}>
      רישום תשלום
    </Button>
  );

  return (
    <CollapsibleSection
      title="מה לעשות"
      icon={<ChecklistIcon className={SECTION_ICON_CLASS} />}
      summary={todo.length > 0 ? <SectionCount count={todo.length} /> : null}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
    >
      {todo.length === 0 ? (
        <EmptyState dense>הכול בסדר — אין כרגע מה לטפל בו.</EmptyState>
      ) : (
        <ul className="divide-y">
          {todo.map((item, i) => {
            switch (item.kind) {
              case "bounced":
                return line(
                  `b${i}`,
                  "danger",
                  "צ׳ק חזר",
                  `${who(item.row)} · ${checkName(item.check)} · ${formatCurrency(item.check.amount)} — לבקש צ׳ק אחר או תשלום`,
                  pay(item.row, undefined, true)
                );
              case "late":
                return line(
                  `l${i}`,
                  "danger",
                  "באיחור",
                  `${who(item.row)} · ${formatCurrency(lateThisMonth(item.row, today))} · ${item.days} ימים (${item.row.periodLabel})`,
                  pay(item.row, undefined, true)
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
                    <Link href={rentChecksHref()}>לצ׳קים</Link>
                  </Button>
                );
              }
              case "debt":
                return line(
                  `o${i}`,
                  "danger",
                  "חוב ישן",
                  `${who(item.row)} · ${formatCurrency(item.row.debt.amount)} · ${debtWords(item.row.debt)}`,
                  item.row.debt.oldest ? pay(item.row, item.row.debt.oldest) : null
                );
              case "checksLow": {
                const hand = item.row.checksInHand;
                const text = hand.count === 0 ? "אין צ׳קים ביד" : `נשארו ${hand.count}, עד ${hand.lastLabel}`;
                const href = whatsappHref(
                  item.row.lease.customerPhone,
                  `שלום ${item.row.lease.customerName ?? ""}, הצ׳קים לשכירות ב${placeName(item.row)} ${hand.count === 0 ? "נגמרו" : `נגמרים ב${hand.lastLabel}`}. אפשר להעביר את הצ׳קים הבאים?`
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
                  ) : null
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
                  </Button>
                );
              case "vacant":
                return line(
                  `v${i}`,
                  "muted",
                  "בלי שוכר",
                  item.properties.map((p) => propertyDisplayName(p)).join(" · "),
                  <Button asChild size="sm" variant="outline" className={ROW_BUTTON}>
                    <Link href="/properties">לנכסים</Link>
                  </Button>
                );
            }
          })}
        </ul>
      )}
    </CollapsibleSection>
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
          tone === "warning" && "text-warning-strong"
        )}
      >
        {value}
      </div>
      {progress != null ? (
        <div className="my-1 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-success" style={{ width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%` }} />
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
                        cell.returned.length > 0 && "ring-2 ring-destructive/60"
                      )}
                    >
                      {look.mark}
                    </button>
                  </td>
                );
              })}
              <td className={cn(CELL, "whitespace-nowrap tabular-nums")}>
                {owed > 0.5 ? <span className="font-medium text-destructive">{formatCurrency(owed)}</span> : <span className="text-muted-foreground">—</span>}
              </td>
            </tr>
          );
        })}
      </DataTableShell>
      {/* What the marks mean. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {(["paid", "check", "partial", "late", "upcoming"] as const).map((state) => (
          <span key={state} className="inline-flex items-center gap-1">
            <span className={cn("inline-flex h-5 min-w-6 items-center justify-center rounded-full px-1.5 font-semibold", CELL_LOOK[state].className)}>
              {CELL_LOOK[state].mark}
            </span>
            {state === "check" ? "צ׳ק ממתין לפירעון" : RENT_STATE[state].label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1">
          <span className={cn("inline-flex h-5 min-w-6 items-center justify-center rounded-full px-1.5 font-semibold", AHEAD_CHECK)}>צ׳</span>
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

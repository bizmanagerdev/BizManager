"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterChip, SEGMENT, SEGMENTED_GROUP, TOGGLE_OFF, TOGGLE_ON } from "@/components/ui/filter-chip";
import { DocumentLink } from "@/components/ui/document-tile";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AttachIcon, ChevronLeftIcon, ChevronRightIcon, MoreIcon, PrintIcon, SpreadsheetIcon } from "@/components/ui/icons";
import { PageStack } from "@/components/layout/page-layout";
import { useUndoOverlay } from "@/hooks/useUndoOverlay";
import { CONNECTION_EVENTS } from "@/lib/offline-queue";
import { getUndoPatch, scheduleDeferredEdit } from "@/lib/undo-engine";
import { toHebrewError } from "@/lib/error-messages";
import { formatShortDate } from "@/lib/date";
import { formatCurrency } from "@/lib/payroll";
import { paymentMethodLabel } from "@/lib/orders/paymentStatus";
import type { FinancialAttachment } from "@/lib/payments";
import { propertyDisplayName, type PropertyPayment, type RentRollData, type RentRollPayment, type RentRollProperty } from "@/lib/properties";
import { RENT_STATE, type RentMonthState } from "@/lib/property-rent";
import { daysBetween, rentRollMonth, rentRollOffsetFor, rentRollYear, rentRowOwes, type RentDebt, type RentRollRow, type RentRollYear } from "@/lib/rent-roll";
import { rentPeriodLabel } from "@/lib/rent-periods";
import { israelDateKey } from "@/lib/timezone";
import { cn } from "@/lib/utils";
import PropertyRentPaymentDialog from "@/app/(app)/properties/[id]/PropertyRentPaymentDialog";
import PropertyCheckArrivedDialog from "@/app/(app)/properties/[id]/PropertyCheckArrivedDialog";
import PropertyPaidInsteadDialog from "@/app/(app)/properties/[id]/PropertyPaidInsteadDialog";
import { deposit, downloadExcel, monthSheet, printSheet, yearSheet } from "./rentRollExport";

// The rent roll (owner, 2026-10-21): every lease's rent for the month on one
// page, marked from its row (the property's own dialogs, the month already
// set). Plain and dense (the owner, same day: "a table with columns … very
// narrow rows … just very functional"): on a computer a table — what it is,
// whether it's paid, when, how, into which account, the check and its photo;
// on a phone the same as short lines. Then what a rent roll carries (the
// owner chose all of it after looking at what such a system needs): what
// earlier months still owe, in its own column by how old; the post-dated
// checks still in hand and the last month they reach; the lease's end and
// its deposit; the properties with no tenant; a check that came back; a year
// at a glance; and the month or the year to Excel or on paper.

const paymentKey = (p: RentRollPayment) => p.id;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A lease ending this soon, or checks running out this soon: in colour. */
const SOON_DAYS = 60;

type View = "month" | "year";
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

/** The table's short words for how it came (the whole name on the phone's lines and on paper). */
const SHORT_METHOD: Record<string, string> = { bank_transfer: "העברה", cash: "מזומן", bit: "ביט", credit_card: "אשראי" };

function methodWord(payment: RentRollPayment, short = false): string {
  if (payment.method === "check") return payment.paymentStatus === "pending" ? "צ׳ק (ממתין)" : "צ׳ק";
  if (short && payment.method && SHORT_METHOD[payment.method]) return SHORT_METHOD[payment.method];
  const label = paymentMethodLabel(payment.method);
  return label && label !== "-" ? label : "—";
}

function checkName(payment: RentRollPayment): string {
  return payment.checkNumber ? `צ׳ק #${payment.checkNumber}` : "הצ׳ק";
}

/** What it paid: its amount, and how many months when more than this one ("₪17,000 · 2 חודשים", in the table "₪17,000 ×2"). */
function paidWords(payment: RentRollPayment, short = false): string {
  if (payment.rentPeriods <= 1) return formatCurrency(payment.amount);
  return short ? `${formatCurrency(payment.amount)} ×${payment.rentPeriods}` : `${formatCurrency(payment.amount)} · ${payment.rentPeriods} חודשים`;
}

/** The months a payment pays, in words — on hover ("ספטמבר – אוקטובר 2026"). */
function paidMonths(row: RentRollRow, payment: RentRollPayment): string | undefined {
  return payment.rentPeriods > 1 && payment.rentPeriodStart
    ? rentPeriodLabel(row.lease, payment.rentPeriodStart, payment.rentPeriods)
    : undefined;
}

/** The old debt's age in days — its oldest part ("60+") — and the whole of it, by age, on hover. */
function debtAge(debt: RentDebt): { label: string; title: string } {
  const label = debt.over60 > 0.5 ? "60+" : debt.upTo60 > 0.5 ? "31–60" : "≤30";
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

/** One line per payment in a cell (a month paid in two parts has two). */
function Lines({ row, render }: { row: RentRollRow; render: (p: RentRollPayment) => ReactNode }) {
  if (row.payments.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <>
      {row.payments.map((p) => (
        <div key={p.id} className="whitespace-nowrap">
          {render(p)}
        </div>
      ))}
    </>
  );
}

/** A year cell's look: what the month's state is, at a glance. */
const CELL: Record<RentMonthState, { mark: string; className: string }> = {
  paid: { mark: "✓", className: "bg-success/15 text-success" },
  check: { mark: "צ׳", className: "bg-secondary/15 text-secondary" },
  partial: { mark: "½", className: "bg-warning/20 text-warning-strong" },
  late: { mark: "✗", className: "bg-destructive/15 text-destructive" },
  upcoming: { mark: "·", className: "bg-muted text-muted-foreground" },
  none: { mark: "", className: "" },
};

/** The property column stays in view while the table scrolls sideways. */
const STICKY = "sticky start-0 z-10 bg-card";

export default function RentRollClient({ data }: { data: RentRollData }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  // One day for the whole visit: the months don't move under the owner's hand at midnight.
  const [today] = useState(() => israelDateKey());
  const [view, setView] = useState<View>("month");
  const [offset, setOffset] = useState(0);
  const [owingOnly, setOwingOnly] = useState(false);
  // The rent recorded here, shown at once — until the page's own data has it.
  const [recorded, setRecorded] = useState<RentRollPayment[]>([]);
  const [landed, setLanded] = useState<string | null>(null);
  // The payments' files (a check's photo) — from the server, after the roll is on screen.
  const [files, setFiles] = useState<Record<string, FinancialAttachment[]>>({});

  const [paying, setPaying] = useState<RentRollRow | null>(null);
  const [payingOpen, setPayingOpen] = useState(false);
  const [arrival, setArrival] = useState<{ payment: PropertyPayment; title: string } | null>(null);
  const [instead, setInstead] = useState<{ row: RentRollRow; payment: PropertyPayment; title: string } | null>(null);

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
  const month = useMemo(() => rentRollMonth(rollData, offset, today), [rollData, offset, today]);
  const year = useMemo(() => (view === "year" ? rentRollYear(rollData, offset, today) : null), [view, rollData, offset, today]);
  const owing = month.rows.filter(rentRowOwes);
  const rows = owingOnly ? owing : month.rows;
  const vacant = owingOnly ? [] : month.vacant;

  // The rent alert's link — /rent#<lease>@<period> — opens its month, at its row.
  useEffect(() => {
    const match = /^#([0-9a-f-]{36})@(\d{4}-\d{2}-\d{2})$/i.exec(window.location.hash);
    if (!match) return;
    const [, leaseId, period] = match;
    setOffset(rentRollOffsetFor(data, leaseId, period, today));
    setLanded(leaseId);
    requestAnimationFrame(() => {
      const wide = document.getElementById(`lease-${leaseId}`);
      (wide?.offsetParent ? wide : document.getElementById(`lease-m-${leaseId}`))?.scrollIntoView({ block: "center" });
    });
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A save waiting for signal went out: read the roll again (the one saved here gives way to it).
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
        .filter((p) => p.leaseId === paying.lease.id && p.paymentStatus !== "rejected")
        .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || b.id.localeCompare(a.id))[0] ?? null
    : null;
  const payingPayments = paying ? payments.filter((p) => p.propertyId === paying.property.id) : [];
  const insteadPayments = instead ? payments.filter((p) => p.propertyId === instead.row.property.id) : [];
  const { totals } = month;
  const accountName = (id: string | null) => (id ? data.accountNames[id] ?? "—" : "—");

  function openPayment(row: RentRollRow) {
    setPaying(row);
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

  function actionsFor(row: RentRollRow, compact: boolean) {
    const pending = row.payments.find((p) => p.method === "check" && p.paymentStatus === "pending") ?? null;
    const cleared = row.payments.filter((p) => p.method === "check" && p.paymentStatus !== "pending");
    const title = `שכירות ${row.periodLabel}`;
    const size = compact ? "h-7 px-2.5 text-xs" : undefined;
    const menu: { key: string; label: string; onSelect: () => void; danger?: boolean }[] = [];
    if (pending) {
      menu.push({ key: "cleared", label: "נפרע", onSelect: () => setArrival({ payment: pending, title }) });
      menu.push({ key: "instead", label: "שולם אחרת החודש (העברה / מזומן)", onSelect: () => setInstead({ row, payment: pending, title }) });
      menu.push({ key: "bounce", label: `${checkName(pending)} חזר`, onSelect: () => setBounced(pending, true), danger: true });
    }
    for (const check of cleared) {
      menu.push({ key: `bounce-${check.id}`, label: `${checkName(check)} חזר`, onSelect: () => setBounced(check, true), danger: true });
    }
    for (const check of row.returned) {
      menu.push({ key: `back-${check.id}`, label: `ביטול: ${checkName(check)} לא חזר`, onSelect: () => setBounced(check, false) });
    }
    const due = pending !== null && (pending.dueDate ?? pending.date ?? "") <= today;
    return (
      <div className="flex items-center justify-end gap-1">
        {pending && due ? (
          <Button type="button" size="sm" className={size} onClick={() => setArrival({ payment: pending, title })}>
            נפרע
          </Button>
        ) : !pending && row.owed > 0.5 ? (
          <Button
            type="button"
            size="sm"
            className={size}
            variant={row.status.state === "late" ? "default" : "outline"}
            onClick={() => openPayment(row)}
          >
            רישום תשלום
          </Button>
        ) : null}
        {menu.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn("p-0 text-muted-foreground hover:text-foreground", compact ? "h-7 w-7" : "h-9 w-9")}
                aria-label={`פעולות לשכירות של ${propertyDisplayName(row.property)}`}
              >
                <MoreIcon className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {menu.map((item) => (
                <DropdownMenuItem
                  key={item.key}
                  onClick={item.onSelect}
                  className={item.danger ? "text-destructive focus:text-destructive" : undefined}
                >
                  {item.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    );
  }

  const stateBadge = (row: RentRollRow) => {
    const state = RENT_STATE[row.status.state];
    return (
      <Badge variant={state.badge} className="px-2 py-0.5">
        {state.label}
      </Badge>
    );
  };

  const leaseEnd = (row: RentRollRow): ReactNode => {
    const end = row.lease.endDate?.slice(0, 10);
    if (!end) return <span className="text-muted-foreground">—</span>;
    const days = daysBetween(today, end);
    if (days < 0) return <span className="text-muted-foreground">הסתיים {formatShortDate(end)}</span>;
    return (
      <span className={days <= SOON_DAYS ? "font-medium text-destructive" : undefined}>
        {formatShortDate(end)}
        {days <= SOON_DAYS ? ` · עוד ${days} ימים` : ""}
      </span>
    );
  };
  const checksInHand = (row: RentRollRow): ReactNode => {
    const hand = row.checksInHand;
    if (hand.count === 0) return <span className="text-muted-foreground">—</span>;
    const soon = hand.lastPeriod !== null && daysBetween(today, hand.lastPeriod) <= SOON_DAYS;
    return (
      <span
        className={soon ? "font-medium text-warning-strong" : undefined}
        title={`${hand.count} צ׳קים · ${formatCurrency(hand.amount)} · עד ${hand.lastLabel}${soon ? " — נגמרים בקרוב, לבקש חדשים" : ""}`}
      >
        {hand.count} · עד {hand.lastLabel?.replace(/ (תש\S*|\d{4})$/, "")}
      </span>
    );
  };
  const debtCell = (row: RentRollRow): ReactNode => {
    if (row.debt.amount <= 0.5) return <span className="text-muted-foreground">—</span>;
    const age = debtAge(row.debt);
    return (
      <span className="text-destructive" title={age.title}>
        <span className="font-medium tabular-nums">{formatCurrency(row.debt.amount)}</span>
        <span className="text-xs"> ({age.label})</span>
      </span>
    );
  };

  const sheet = () => (view === "year" && year ? yearSheet(year) : monthSheet(month, data.accountNames));
  const label = view === "year" && year ? `${year.headers[0]} – ${year.headers[year.headers.length - 1]}` : month.label;

  return (
    <PageStack>
      {/* One row on top: the view, the month, its money, the "who owes" filter, and out to Excel / paper. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div role="group" aria-label="תצוגה" className={cn(SEGMENTED_GROUP, "h-9 rounded-lg p-0.5 shadow-none")}>
          {(
            [
              ["month", "חודש"],
              ["year", "שנה"],
            ] as const
          ).map(([value, text]) => (
            <button
              key={value}
              type="button"
              aria-pressed={view === value}
              onClick={() => setView(value)}
              className={cn(SEGMENT, "flex items-center rounded-md px-3 py-0 text-xs", view === value ? TOGGLE_ON : TOGGLE_OFF)}
            >
              {text}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <div className="inline-flex h-9 items-center rounded-lg border bg-card">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              aria-label="החודש הקודם"
              onClick={() => setOffset((n) => n - 1)}
            >
              <ChevronRightIcon className="h-4 w-4" />
            </Button>
            <h2 className="whitespace-nowrap px-1 text-sm font-semibold">{label}</h2>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              aria-label="החודש הבא"
              onClick={() => setOffset((n) => n + 1)}
            >
              <ChevronLeftIcon className="h-4 w-4" />
            </Button>
          </div>
          {offset !== 0 ? (
            <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs text-secondary" onClick={() => setOffset(0)}>
              לחודש הזה
            </Button>
          ) : null}
        </div>

        {view === "month" ? (
          <>
            <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <Figure label="שכירות החודש" value={totals.expected} />
              <Figure
                label="התקבל"
                value={totals.collected}
                className="text-success"
                note={totals.collectedByCheck > 0.5 ? `מזה בצ׳קים ${formatCurrency(totals.collectedByCheck)}` : undefined}
              />
              <Figure label="צ׳קים לפירעון" value={totals.checks} />
              <Figure label="חסר" value={totals.owed} className={totals.owed > 0.5 ? "text-destructive" : undefined} />
              {totals.debt > 0.5 ? <Figure label="חוב קודם" value={totals.debt} className="text-destructive" /> : null}
              {totals.checksInHand.count > 0 ? (
                <div className="flex items-baseline gap-1.5">
                  <dt className="text-muted-foreground">צ׳קים ביד</dt>
                  <dd className="font-semibold tabular-nums">
                    {totals.checksInHand.count} · <span dir="ltr">{formatCurrency(totals.checksInHand.amount)}</span>
                  </dd>
                </div>
              ) : null}
            </dl>
            <FilterChip
              active={owingOnly}
              label={owing.length > 0 ? `רק מי שחייב (${owing.length})` : "רק מי שחייב"}
              onClick={() => setOwingOnly((v) => !v)}
            />
          </>
        ) : null}

        <div className="ms-auto flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 px-2.5 text-xs"
            onClick={() => void downloadExcel(sheet()).catch(() => toast.error("ההורדה נכשלה."))}
          >
            <SpreadsheetIcon className="h-4 w-4" />
            אקסל
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 px-2.5 text-xs"
            onClick={() => {
              if (!printSheet(sheet())) toast.error("הדפדפן חסם את חלון ההדפסה.");
            }}
          >
            <PrintIcon className="h-4 w-4" />
            הדפסה
          </Button>
        </div>
      </div>

      {view === "year" && year ? (
        <YearTable
          year={year}
          onCell={(row, i) => {
            if (!row.payments.some((p) => p.paymentStatus === "pending") && row.owed > 0.5) {
              openPayment(row);
              return;
            }
            setView("month");
            setOffset(year.offsets[i]);
            setLanded(row.key);
          }}
        />
      ) : rows.length === 0 && vacant.length === 0 ? (
        <Card className="p-4">
          <EmptyState dense>{month.rows.length === 0 ? "אין שכירות לחודש הזה." : "אף אחד לא חייב."}</EmptyState>
        </Card>
      ) : (
        <div>
          {/* A computer: the table (scrolling sideways in its card when wider than it, the property column held). */}
          <Card className="hidden overflow-x-auto lg:block">
            <table className="w-full text-[0.8125rem]">
              <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  {[
                    "נכס",
                    "שוכר",
                    "מועד",
                    "שכירות",
                    "מצב",
                    "שולם",
                    "תאריך",
                    "אמצעי",
                    "חשבון",
                    "צ׳ק",
                    "חוב קודם",
                    "צ׳קים ביד",
                    "חוזה עד",
                    "פיקדון",
                    "",
                  ].map((head, i) => (
                    <th key={i} scope="col" className={cn("whitespace-nowrap px-1.5 py-2 text-start font-medium", i === 0 && cn(STICKY, "bg-muted"))}>
                      {head}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((row) => (
                  <tr
                    key={row.key}
                    id={`lease-${row.key}`}
                    className={cn("scroll-mt-24 align-top hover:bg-muted/20", landed === row.key && "bg-secondary/10")}
                  >
                    <td className={cn("whitespace-nowrap px-1.5 py-1.5", STICKY)}>
                      <Link href={`/properties/${row.property.id}#rent`} className="font-medium hover:underline">
                        {placeName(row)}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-1.5 py-1.5">{row.lease.customerName ?? "—"}</td>
                    <td className="whitespace-nowrap px-1.5 py-1.5">{row.dueLabel}</td>
                    <td className="whitespace-nowrap px-1.5 py-1.5 tabular-nums">{formatCurrency(row.status.rent)}</td>
                    <td className="whitespace-nowrap px-1.5 py-1.5">
                      {stateBadge(row)}
                      {row.status.state === "partial" && row.owed > 0.5 ? (
                        <div className="text-xs text-destructive">חסר {formatCurrency(row.owed)}</div>
                      ) : null}
                      {row.returned.length > 0 ? <div className="text-xs text-destructive">צ׳ק חזר</div> : null}
                    </td>
                    <td className="px-1.5 py-1.5 tabular-nums">
                      <Lines row={row} render={(p) => <span title={paidMonths(row, p)}>{paidWords(p, true)}</span>} />
                    </td>
                    <td className="px-1.5 py-1.5">
                      <Lines row={row} render={moneyDate} />
                    </td>
                    <td className="px-1.5 py-1.5">
                      <Lines row={row} render={(p) => methodWord(p, true)} />
                    </td>
                    <td className="px-1.5 py-1.5">
                      <Lines row={row} render={(p) => accountName(p.accountId)} />
                    </td>
                    <td className="px-1.5 py-1.5">
                      {row.payments.length === 0 && row.returned.length === 0 ? <span className="text-muted-foreground">—</span> : null}
                      {row.payments.map((p) => (
                        <div key={p.id} className="flex items-center gap-1.5 whitespace-nowrap">
                          {p.method === "check" ? (
                            <span>{p.checkNumber ? `#${p.checkNumber}` : "—"}</span>
                          ) : files[p.id]?.some((f) => f.url) ? null : (
                            <span className="text-muted-foreground">—</span>
                          )}
                          <PaymentFiles payment={p} files={files[p.id]} />
                        </div>
                      ))}
                      {row.returned.map((p) => (
                        <div key={p.id} className="flex items-center gap-1.5 whitespace-nowrap text-destructive">
                          <span>
                            {p.checkNumber ? `#${p.checkNumber}` : "צ׳ק"} · חזר ({formatCurrency(p.amount)})
                          </span>
                          <PaymentFiles payment={p} files={files[p.id]} />
                        </div>
                      ))}
                    </td>
                    <td className="whitespace-nowrap px-1.5 py-1.5">{debtCell(row)}</td>
                    <td className="whitespace-nowrap px-1.5 py-1.5">{checksInHand(row)}</td>
                    <td className="whitespace-nowrap px-1.5 py-1.5">{leaseEnd(row)}</td>
                    <td className="whitespace-nowrap px-1.5 py-1.5">{deposit(row) || <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-1.5 py-1">{actionsFor(row, true)}</td>
                  </tr>
                ))}
                {vacant.map((property) => (
                  <tr key={`vacant-${property.id}`} className="align-top text-muted-foreground">
                    <td className={cn("whitespace-nowrap px-1.5 py-1.5", STICKY)}>
                      <Link href={`/properties/${property.id}`} className="font-medium text-foreground hover:underline">
                        {propertyDisplayName(property)}
                      </Link>
                    </td>
                    <td className="px-1.5 py-1.5">—</td>
                    <td className="px-1.5 py-1.5" />
                    <td className="px-1.5 py-1.5" />
                    <td className="whitespace-nowrap px-1.5 py-1.5">
                      <Badge variant="neutral" className="px-2 py-0.5">
                        אין שוכר
                      </Badge>
                    </td>
                    <td colSpan={10} />
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {/* A phone: each lease as short lines. */}
          <Card className="lg:hidden">
            <ul className="divide-y">
              {rows.map((row) => (
                <li key={row.key} id={`lease-m-${row.key}`} className={cn("scroll-mt-24 px-3 py-2", landed === row.key && "bg-secondary/10")}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 text-sm">
                      <Link href={`/properties/${row.property.id}#rent`} className="font-medium hover:underline">
                        {placeName(row)}
                      </Link>
                      <span className="text-muted-foreground"> · {row.lease.customerName ?? "שוכר"}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span className="text-sm font-semibold tabular-nums">{formatCurrency(row.status.rent)}</span>
                      {stateBadge(row)}
                    </div>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <div className="min-w-0 space-y-0.5 text-xs text-muted-foreground">
                      {row.payments.length === 0 ? (
                        <div>{row.status.state === "late" ? `היה לשלם ב-${row.dueLabel}` : `לתשלום ב-${row.dueLabel}`}</div>
                      ) : (
                        row.payments.map((p) => (
                          <div key={p.id} className="flex flex-wrap items-center gap-x-1.5">
                            <span>
                              {[
                                moneyDate(p),
                                p.method === "check" && p.checkNumber ? `צ׳ק #${p.checkNumber}` : methodWord(p),
                                accountName(p.accountId),
                                row.payments.length > 1 || p.rentPeriods > 1 ? paidWords(p) : null,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                            <PaymentFiles payment={p} files={files[p.id]} />
                          </div>
                        ))
                      )}
                      {row.returned.map((p) => (
                        <div key={p.id} className="text-destructive">
                          {checkName(p)} חזר · {formatCurrency(p.amount)}
                        </div>
                      ))}
                      {row.status.state === "partial" && row.owed > 0.5 ? (
                        <div className="text-destructive">חסר {formatCurrency(row.owed)}</div>
                      ) : null}
                      {/* What the month's state doesn't say: old debt, checks in hand, the lease's end. */}
                      <div className="flex flex-wrap gap-x-3">
                        {row.debt.amount > 0.5 ? <span>חוב קודם {debtCell(row)}</span> : null}
                        {row.checksInHand.count > 0 ? <span>צ׳קים ביד {checksInHand(row)}</span> : null}
                        {row.lease.endDate ? <span>חוזה עד {leaseEnd(row)}</span> : null}
                      </div>
                    </div>
                    <div className="shrink-0">{actionsFor(row, false)}</div>
                  </div>
                </li>
              ))}
              {vacant.map((property) => (
                <li key={`vacant-${property.id}`} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <Link href={`/properties/${property.id}`} className="font-medium hover:underline">
                    {propertyDisplayName(property)}
                  </Link>
                  <Badge variant="neutral" className="px-2 py-0.5">
                    אין שוכר
                  </Badge>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      <PropertyRentPaymentDialog
        open={payingOpen}
        onOpenChange={setPayingOpen}
        propertyId={paying?.property.id ?? ""}
        lease={paying?.lease ?? null}
        payments={payingPayments}
        prefill={paying ? { periodStart: paying.period, method: usual?.method, accountId: usual?.accountId } : undefined}
        onRecorded={paying ? remember(paying.property.id) : undefined}
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

/** The year at a glance: each lease a row, each month a cell; this month's column marked. */
function YearTable({ year, onCell }: { year: RentRollYear; onCell: (row: RentRollRow, index: number) => void }) {
  // A narrow screen scrolls the months sideways: it opens on this one, not on the oldest.
  const currentHead = useRef<HTMLTableCellElement>(null);
  useEffect(() => {
    currentHead.current?.scrollIntoView?.({ inline: "center", block: "nearest" });
  }, []);
  if (year.rows.length === 0) {
    return (
      <Card className="p-4">
        <EmptyState dense>אין שכירות בחודשים האלה.</EmptyState>
      </Card>
    );
  }
  const current = year.offsets.indexOf(0);
  return (
    <div className="space-y-2">
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th scope="col" className={cn("whitespace-nowrap px-2 py-2 text-start font-medium", STICKY, "bg-muted")}>
                נכס
              </th>
              <th scope="col" className="whitespace-nowrap px-2 py-2 text-start font-medium">
                שוכר
              </th>
              {year.headers.map((head, i) => (
                <th
                  key={i}
                  ref={i === current ? currentHead : undefined}
                  scope="col"
                  className={cn("whitespace-nowrap px-1 py-2 text-center font-medium", i === current && "bg-secondary/10 text-foreground")}
                >
                  {head}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {year.rows.map((row) => (
              <tr key={row.key} className="hover:bg-muted/20">
                <td className={cn("whitespace-nowrap px-2 py-1", STICKY)}>
                  <Link href={`/properties/${row.property.id}#rent`} className="font-medium hover:underline">
                    {placeName(row)}
                  </Link>
                </td>
                <td className="whitespace-nowrap px-2 py-1">{row.lease.customerName ?? "—"}</td>
                {row.cells.map((cell, i) => {
                  if (!cell) return <td key={i} className={cn("px-1 py-1", i === current && "bg-secondary/5")} />;
                  const look = CELL[cell.status.state];
                  const words = [
                    `${cell.periodLabel}: ${RENT_STATE[cell.status.state].label}`,
                    ...cell.payments.map((p) => `${formatCurrency(p.amount)} · ${moneyDate(p)} · ${methodWord(p)}`),
                    ...cell.returned.map((p) => `${checkName(p)} חזר`),
                  ].join("\n");
                  return (
                    <td key={i} className={cn("px-1 py-1 text-center", i === current && "bg-secondary/5")}>
                      <button
                        type="button"
                        title={words}
                        aria-label={words}
                        onClick={() => onCell(cell, i)}
                        className={cn(
                          "inline-flex h-7 min-w-9 items-center justify-center rounded-md px-1.5 text-xs font-semibold hover:ring-2 hover:ring-ring/30",
                          look.className,
                          cell.returned.length > 0 && "ring-2 ring-destructive/60"
                        )}
                      >
                        {look.mark}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {/* What the marks mean. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {(["paid", "check", "partial", "late", "upcoming"] as const).map((state) => (
          <span key={state} className="inline-flex items-center gap-1">
            <span className={cn("inline-flex h-5 min-w-6 items-center justify-center rounded px-1 font-semibold", CELL[state].className)}>
              {CELL[state].mark}
            </span>
            {RENT_STATE[state].label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1">
          <span className="inline-flex h-5 min-w-6 rounded ring-2 ring-destructive/60" />
          צ׳ק חזר
        </span>
      </div>
    </div>
  );
}

function Figure({ label, value, className, note }: { label: string; value: number; className?: string; note?: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("font-semibold tabular-nums", className)}>
        <span dir="ltr">{formatCurrency(value)}</span>
        {note ? <span className="ms-1 text-xs font-normal text-muted-foreground">({note})</span> : null}
      </dd>
    </div>
  );
}

"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatActionCard } from "@/components/ui/stat-action-card";
import { ContactTapZone } from "@/components/ui/contact-link";
import { DocumentLink } from "@/components/ui/document-tile";
import { ChevronDownIcon, DocumentIcon, MoreIcon, PaymentIcon, UserIcon } from "@/components/ui/icons";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatCurrency } from "@/lib/payroll";
import { formatShortDate } from "@/lib/date";
import { israelDateKey } from "@/lib/timezone";
import { depositTypeLabel, leaseStatusLabel, type LeaseAgreement, type PropertyPayment } from "@/lib/properties";
import { dayKey, paymentTitle } from "./propertyMovements";

// The property page's two lease cards, beside "נכס" in its head row (owner,
// 2026-10-20: like the project page — one clear details page): who rents it
// and on what terms, and where this month's rent stands.

function LeaseFile({ lease }: { lease: LeaseAgreement }) {
  if (!lease.documentId) return null;
  const label = lease.documentFileName || "חוזה חתום";
  // Opens as it did; הורדה follows it on hover (owner, 2026-10-12).
  return lease.documentUrl ? (
    <DocumentLink
      name={label}
      fileName={lease.documentFileName}
      url={lease.documentUrl}
      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
    >
      <DocumentIcon className="h-3.5 w-3.5" />
      <span>{label}</span>
    </DocumentLink>
  ) : (
    <div className="flex items-center gap-1 text-xs text-muted-foreground">
      <DocumentIcon className="h-3.5 w-3.5" />
      <span>{label} — לא ניתן לפתוח את הקובץ</span>
    </div>
  );
}

export function PropertyTenantCard({
  lease,
  pastLeases,
  keyCount,
  onEdit,
  onNew,
  onDelete,
}: {
  lease: LeaseAgreement | null;
  pastLeases: LeaseAgreement[];
  /** The apartment's own set of keys — "2 מתוך 4" at move-out. */
  keyCount: number | null;
  onEdit: (lease: LeaseAgreement) => void;
  onNew: () => void;
  onDelete: (lease: LeaseAgreement) => void;
}) {
  const details = lease
    ? [
        { label: "שכר דירה", value: `${formatCurrency(lease.monthlyRentAmount)} לחודש` },
        {
          label: "תקופה",
          value: [formatShortDate(lease.startDate, ""), lease.endDate ? formatShortDate(lease.endDate, "") : "ללא סיום"]
            .filter(Boolean)
            .join(" – "),
        },
        lease.depositType
          ? {
              label: "פיקדון",
              value: [depositTypeLabel(lease.depositType), lease.depositAmount != null ? formatCurrency(lease.depositAmount) : null]
                .filter(Boolean)
                .join(" · "),
            }
          : null,
        lease.keysHandedOver != null
          ? { label: "מפתחות", value: keyCount != null ? `${lease.keysHandedOver} מתוך ${keyCount}` : String(lease.keysHandedOver) }
          : null,
      ].filter((d): d is { label: string; value: string } => Boolean(d))
    : [];

  return (
    <StatActionCard
      icon={<UserIcon className="h-5 w-5" />}
      label="שוכר"
      value={
        lease ? (
          <Link href={`/customers/${lease.customerId}`} className="text-lg font-bold leading-snug hover:underline">
            {lease.customerName ?? "שוכר"}
          </Link>
        ) : (
          "פנוי"
        )
      }
      valueClassName={lease ? undefined : "text-muted-foreground"}
      badges={
        lease ? <Badge variant={lease.status === "active" ? "success" : "neutral"}>{leaseStatusLabel(lease.status)}</Badge> : null
      }
      subtitles={[
        lease?.customerPhone ? (
          <ContactTapZone kind="tel" value={lease.customerPhone} className="hover:underline">
            <span dir="ltr">{lease.customerPhone}</span>
          </ContactTapZone>
        ) : null,
        lease ? null : "אין חוזה שכירות פעיל.",
      ]}
      details={details}
      action={
        <div className="flex items-center gap-1.5">
          <Button type="button" size="sm" className="flex-1" onClick={() => (lease ? onEdit(lease) : onNew())}>
            {lease ? "עריכת החוזה" : "חוזה חדש"}
          </Button>
          {lease ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" size="sm" variant="ghost" className="h-9 w-9 p-0" aria-label="עוד פעולות לחוזה">
                  <MoreIcon className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onNew}>חוזה חדש</DropdownMenuItem>
                <DropdownMenuItem onClick={() => onDelete(lease)} className="text-destructive focus:text-destructive">
                  מחיקת החוזה
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      }
    >
      {lease ? <LeaseFile lease={lease} /> : null}
      {lease?.notes ? <p className="whitespace-pre-wrap text-xs text-muted-foreground">{lease.notes}</p> : null}
      {pastLeases.length > 0 ? (
        <details className="group text-xs">
          <summary className="flex cursor-pointer list-none items-center gap-1 font-medium text-muted-foreground hover:text-foreground">
            <ChevronDownIcon className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
            חוזים קודמים ({pastLeases.length})
          </summary>
          <ul className="mt-2 space-y-2">
            {pastLeases.map((past) => (
              <li key={past.id} className="flex items-start justify-between gap-2 text-xs">
                <div className="min-w-0">
                  <Link href={`/customers/${past.customerId}`} className="font-medium hover:underline">
                    {past.customerName ?? "שוכר"}
                  </Link>
                  <div className="text-muted-foreground">
                    {[formatShortDate(past.startDate, ""), formatShortDate(past.endDate, "")].filter(Boolean).join(" – ")}
                    {" · "}
                    {formatCurrency(past.monthlyRentAmount)} לחודש
                  </div>
                  <LeaseFile lease={past} />
                </div>
                <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onEdit(past)}>
                  עריכה
                </Button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </StatActionCard>
  );
}

export type RentMonthState = "paid" | "partial" | "check" | "late" | "upcoming" | "none";

/**
 * Where this month's rent stands. A scheduled check is dated the month it's
 * for; any other payment counts in the month it came in — until each payment
 * says which month it covers (the next step on the card).
 */
export function rentThisMonth(
  lease: LeaseAgreement | null,
  payments: PropertyPayment[],
  today: string = israelDateKey()
): { state: RentMonthState; collected: number; pending: number; rent: number; dueDay: number | null } {
  if (!lease || lease.status !== "active") return { state: "none", collected: 0, pending: 0, rent: 0, dueDay: null };
  const month = today.slice(0, 7);
  let collected = 0;
  let pending = 0;
  for (const payment of payments) {
    if (dayKey(payment.date)?.slice(0, 7) !== month) continue;
    if (payment.paymentStatus === "pending") pending += payment.amount;
    else if (payment.paymentStatus !== "rejected") collected += payment.amount;
  }
  const rent = lease.monthlyRentAmount;
  const dueDay = lease.rentDayOfMonth ?? (lease.startDate ? Number(lease.startDate.slice(8, 10)) || null : null);
  const state: RentMonthState =
    rent > 0 && collected >= rent - 0.5
      ? "paid"
      : collected > 0
        ? "partial"
        : pending > 0
          ? "check"
          : dueDay !== null && Number(today.slice(8, 10)) > dueDay
            ? "late"
            : "upcoming";
  return { state, collected, pending, rent, dueDay };
}

const RENT_STATE: Record<RentMonthState, { label: string; className: string }> = {
  paid: { label: "שולם", className: "text-success" },
  partial: { label: "שולם חלקית", className: "text-warning-strong" },
  check: { label: "צ׳ק ממתין לפירעון", className: "text-secondary" },
  late: { label: "לא שולם", className: "text-destructive" },
  upcoming: { label: "טרם שולם", className: "text-foreground" },
  none: { label: "אין שוכר", className: "text-muted-foreground" },
};

export function PropertyRentCard({
  lease,
  payments,
  onRecord,
  onSchedule,
}: {
  lease: LeaseAgreement | null;
  payments: PropertyPayment[];
  onRecord: () => void;
  onSchedule: () => void;
}) {
  const today = israelDateKey();
  const status = rentThisMonth(lease, payments, today);
  const year = today.slice(0, 4);
  const collectedThisYear = payments
    .filter((p) => p.paymentStatus !== "pending" && p.paymentStatus !== "rejected")
    .filter((p) => ((p.method === "check" ? p.dueDate : null) ?? dayKey(p.date) ?? "").startsWith(year))
    .reduce((sum, p) => sum + p.amount, 0);
  const waiting = payments.filter((p) => p.paymentStatus === "pending");
  const waitingTotal = waiting.reduce((sum, p) => sum + p.amount, 0);
  const nextCheck = waiting
    .map((p) => ({ p, day: p.dueDate ?? dayKey(p.date) ?? "" }))
    .filter((x) => x.day >= today)
    .sort((a, b) => a.day.localeCompare(b.day))[0];
  const last = payments
    .filter((p) => p.paymentStatus !== "pending" && p.paymentStatus !== "rejected")
    .map((p) => ({ p, day: (p.method === "check" ? p.dueDate : null) ?? dayKey(p.date) ?? "" }))
    .sort((a, b) => b.day.localeCompare(a.day))[0];
  const state = RENT_STATE[status.state];

  const details = [
    status.state !== "none" && status.collected > 0 && status.state !== "paid"
      ? { label: "נגבה החודש", value: `${formatCurrency(status.collected)} מתוך ${formatCurrency(status.rent)}` }
      : null,
    status.state === "upcoming" && status.dueDay ? { label: "מועד", value: `ה-${status.dueDay} בחודש` } : null,
    { label: `נגבה ב-${year}`, value: formatCurrency(collectedThisYear) },
    waiting.length > 0 ? { label: "צ׳קים ממתינים", value: `${waiting.length} · ${formatCurrency(waitingTotal)}` } : null,
    nextCheck ? { label: "הצ׳ק הבא", value: `${formatShortDate(nextCheck.day, "")} · ${formatCurrency(nextCheck.p.amount)}` } : null,
    last ? { label: "תשלום אחרון", value: `${formatShortDate(last.day, "")} · ${paymentTitle(last.p)}` } : null,
  ].filter((d): d is { label: string; value: string } => Boolean(d));

  return (
    <StatActionCard
      icon={<PaymentIcon className="h-5 w-5" />}
      label="שכירות החודש"
      value={state.label}
      valueClassName={state.className}
      details={details}
      action={
        <div className="space-y-1.5">
          <Button type="button" size="sm" className="w-full" onClick={onRecord}>
            רישום תשלום
          </Button>
          {lease ? (
            <Button type="button" size="sm" variant="ghost" className="w-full text-xs" onClick={onSchedule}>
              קביעת תשלומים מראש
            </Button>
          ) : null}
        </div>
      }
    />
  );
}

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
import { dayKey, paymentPeriodLabel, RENT_STATE, rentThisPeriod } from "@/lib/property-rent";
import { rentDueLabel } from "@/lib/rent-periods";
import { depositTypeLabel, leaseStatusLabel, type LeaseAgreement, type PropertyPayment } from "@/lib/properties";
import { paymentTitle, toRentPayment } from "./propertyMovements";

// The property page's two lease cards, beside "נכס" in its head row (owner,
// 2026-10-20: like the project page — one clear details page): who rents it
// and on what terms, and where this month's rent stands.

function LeaseFile({ lease, ready = true }: { lease: LeaseAgreement; ready?: boolean }) {
  if (!lease.documentId) return null;
  const label = lease.documentFileName || "חוזה חתום";
  // Its link comes with the server's part of the page (the device version draws the page first).
  if (!lease.documentUrl && !ready) {
    return (
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <DocumentIcon className="h-3.5 w-3.5" />
        <span>{label}…</span>
      </div>
    );
  }
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
  filesReady = true,
  onEdit,
  onNew,
  onDelete,
}: {
  lease: LeaseAgreement | null;
  pastLeases: LeaseAgreement[];
  /** The apartment's own set of keys — "2 מתוך 4" at move-out. */
  keyCount: number | null;
  /** The leases' signed agreements have their links (the server's part of the page). */
  filesReady?: boolean;
  onEdit: (lease: LeaseAgreement) => void;
  onNew: () => void;
  onDelete: (lease: LeaseAgreement) => void;
}) {
  const details = lease
    ? [
        { label: "שכר דירה", value: `${formatCurrency(lease.monthlyRentAmount)} ${lease.periodMonths === 12 ? "לשנה" : "לחודש"}` },
        { label: "מועד תשלום", value: rentDueLabel(lease) },
        lease.unitLabel || lease.areaSqm
          ? { label: "יחידה", value: [lease.unitLabel, lease.areaSqm ? `${lease.areaSqm} מ״ר` : null].filter(Boolean).join(" · ") }
          : null,
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
      id="tenant"
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
      {lease ? <LeaseFile lease={lease} ready={filesReady} /> : null}
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
                  <LeaseFile lease={past} ready={filesReady} />
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
  // Its rent only: not a refund, not a storage spot's lease on the same property.
  const rentPayments = payments.filter((p) => p.countsAsRent && (!p.leaseId || !lease || p.leaseId === lease.id));
  const status = rentThisPeriod(lease, rentPayments.map(toRentPayment), today);
  const year = today.slice(0, 4);
  const collectedThisYear = rentPayments
    .filter((p) => p.paymentStatus !== "pending" && p.paymentStatus !== "rejected")
    .filter((p) => ((p.method === "check" ? p.dueDate : null) ?? dayKey(p.date) ?? "").startsWith(year))
    .reduce((sum, p) => sum + p.amount, 0);
  const waiting = rentPayments.filter((p) => p.paymentStatus === "pending");
  const waitingTotal = waiting.reduce((sum, p) => sum + p.amount, 0);
  const nextCheck = waiting
    .map((p) => ({ p, day: p.dueDate ?? dayKey(p.date) ?? "" }))
    .filter((x) => x.day >= today)
    .sort((a, b) => a.day.localeCompare(b.day))[0];
  const last = rentPayments
    .filter((p) => p.paymentStatus !== "pending" && p.paymentStatus !== "rejected")
    .map((p) => ({ p, day: (p.method === "check" ? p.dueDate : null) ?? dayKey(p.date) ?? "" }))
    .sort((a, b) => b.day.localeCompare(a.day))[0];
  const state = RENT_STATE[status.state];

  const details = [
    status.state !== "none" && status.collected > 0 && status.state !== "paid"
      ? { label: "נגבה", value: `${formatCurrency(status.collected)} מתוך ${formatCurrency(status.rent)}` }
      : null,
    status.periodStart && (status.state === "upcoming" || status.state === "late")
      ? { label: "מועד", value: formatShortDate(status.periodStart, "") }
      : null,
    { label: `נגבה ב-${year}`, value: formatCurrency(collectedThisYear) },
    waiting.length > 0 ? { label: "צ׳קים ממתינים", value: `${waiting.length} · ${formatCurrency(waitingTotal)}` } : null,
    nextCheck ? { label: "הצ׳ק הבא", value: `${formatShortDate(nextCheck.day, "")} · ${formatCurrency(nextCheck.p.amount)}` } : null,
    last
      ? { label: "תשלום אחרון", value: `${formatShortDate(last.day, "")} · ${paymentTitle(last.p, paymentPeriodLabel(lease, toRentPayment(last.p)))}` }
      : null,
  ].filter((d): d is { label: string; value: string } => Boolean(d));

  return (
    <StatActionCard
      id="rent"
      icon={<PaymentIcon className="h-5 w-5" />}
      label={status.periodLabel ? `שכירות ${status.periodLabel}` : "שכירות החודש"}
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

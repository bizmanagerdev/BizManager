"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatActionCard } from "@/components/ui/stat-action-card";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { SectionCount } from "@/components/ui/section-card";
import { AddIcon, ChevronDownIcon, MoreIcon, PaymentIcon, UserIcon } from "@/components/ui/icons";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatCurrency } from "@/lib/payroll";
import { formatShortDate } from "@/lib/date";
import { RENT_STATE, renterPayments, rentThisPeriod, type RentMonthStatus } from "@/lib/property-rent";
import type { LeaseAgreement, PropertyPayment } from "@/lib/properties";
import { toRentPayment } from "./propertyMovements";

// A property with several renters (owner, 2026-10-20 — the ניהול נכסים card:
// "storage: one big property with a list of renters — how much, monthly or
// yearly, how many meters, start and end"). Each renter is a lease of its own,
// with its unit, its size, its amount per month or per year, and its own rent
// for the period; the head row adds them up.

export type Renter = { lease: LeaseAgreement; status: RentMonthStatus };

export function renterStatuses(leases: LeaseAgreement[], payments: PropertyPayment[], today: string): Renter[] {
  return leases
    .map((lease) => ({
      lease,
      status: rentThisPeriod(lease, renterPayments(lease.id, payments, leases.length === 1).map(toRentPayment), today),
    }))
    .sort(
      (a, b) =>
        (a.lease.unitLabel ?? "").localeCompare(b.lease.unitLabel ?? "", "he", { numeric: true }) ||
        (a.lease.customerName ?? "").localeCompare(b.lease.customerName ?? "", "he")
    );
}

const perPeriod = (lease: LeaseAgreement) => (lease.periodMonths === 12 ? "לשנה" : "לחודש");

/** The head row's "שוכרים": how many, what they pay together, how much is let. */
export function PropertyRentersCard({ renters, onNew }: { renters: Renter[]; onNew: () => void }) {
  const monthly = renters.filter((r) => r.lease.periodMonths !== 12).reduce((sum, r) => sum + r.lease.monthlyRentAmount, 0);
  const yearly = renters.filter((r) => r.lease.periodMonths === 12).reduce((sum, r) => sum + r.lease.monthlyRentAmount, 0);
  const area = renters.reduce((sum, r) => sum + (r.lease.areaSqm ?? 0), 0);
  const details = [
    monthly > 0 ? { label: "סה״כ לחודש", value: formatCurrency(monthly) } : null,
    yearly > 0 ? { label: "סה״כ לשנה", value: formatCurrency(yearly) } : null,
    area > 0 ? { label: "שטח מושכר", value: `${area.toLocaleString("he-IL")} מ״ר` } : null,
  ].filter((d): d is { label: string; value: string } => Boolean(d));
  return (
    <StatActionCard
      id="tenant"
      icon={<UserIcon className="h-5 w-5" />}
      label="שוכרים"
      value={renters.length === 0 ? "פנוי" : renters.length === 1 ? "שוכר אחד" : `${renters.length} שוכרים`}
      valueClassName={renters.length === 0 ? "text-muted-foreground" : undefined}
      subtitles={[renters.length === 0 ? "אין חוזה שכירות פעיל." : null]}
      details={details}
      action={
        <Button type="button" size="sm" className="w-full" onClick={onNew}>
          <AddIcon className="h-4 w-4" />
          שוכר חדש
        </Button>
      }
    />
  );
}

/** The head row's rent: how many have paid this period, and who hasn't. */
export function PropertyRentersRentCard({ renters }: { renters: Renter[] }) {
  const due = renters.filter((r) => r.status.state !== "none");
  const paid = due.filter((r) => r.status.state === "paid" || r.status.state === "check");
  const open = due.filter((r) => r.status.state !== "paid" && r.status.state !== "check");
  const all = due.length > 0 && open.length === 0;
  return (
    <StatActionCard
      id="rent"
      icon={<PaymentIcon className="h-5 w-5" />}
      label="שכירות התקופה"
      value={due.length === 0 ? "אין שוכרים" : all ? "כולם שילמו" : `${paid.length} מתוך ${due.length} שילמו`}
      valueClassName={due.length === 0 ? "text-muted-foreground" : all ? "text-success" : "text-warning-strong"}
      details={open.slice(0, 5).map((r) => ({
        label: r.lease.unitLabel || r.lease.customerName || "שוכר",
        value: `${RENT_STATE[r.status.state].label} · ${formatCurrency(r.status.rent - r.status.collected)}`,
      }))}
    />
  );
}

/** The renters, one row each, with their own רישום תשלום. */
export function PropertyRentersSection({
  renters,
  ended,
  onRecord,
  onSchedule,
  onEdit,
  onDelete,
  onNew,
  onShowPayments,
}: {
  renters: Renter[];
  /** Leases no longer running — folded at the bottom. */
  ended: LeaseAgreement[];
  onRecord: (lease: LeaseAgreement) => void;
  onSchedule: (lease: LeaseAgreement) => void;
  onEdit: (lease: LeaseAgreement) => void;
  onDelete: (lease: LeaseAgreement) => void;
  onNew: () => void;
  /** Their payments in the page's table — to see, edit or delete each one. */
  onShowPayments: (lease: LeaseAgreement) => void;
}) {
  return (
    <CollapsibleSection
      id="renters"
      collapsible={false}
      title={
        <span className="flex items-center gap-1.5">
          שוכרים
          <SectionCount count={renters.length} />
        </span>
      }
      contentClassName="flex flex-col text-sm"
      action={
        <Button type="button" size="sm" variant="outline" onClick={onNew}>
          <AddIcon className="h-4 w-4" />
          שוכר
        </Button>
      }
    >
      {renters.length === 0 ? (
        <p className="py-4 text-center text-muted-foreground">אין עדיין שוכרים. הוסיפו שוכר עם היחידה, השטח והסכום.</p>
      ) : (
        <ul className="divide-y">
          {renters.map(({ lease, status }) => {
            const state = RENT_STATE[status.state];
            const name = lease.customerName ?? "שוכר";
            return (
              <li key={lease.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {lease.unitLabel ? <span className="font-semibold">{lease.unitLabel}</span> : null}
                    <Link href={`/customers/${lease.customerId}`} className="font-medium hover:underline">
                      {name}
                    </Link>
                    {status.state !== "none" ? (
                      // Its payments, a tap away (owner, 2026-10-22: "how can I delete a payment here or edit it or view it").
                      <button
                        type="button"
                        onClick={() => onShowPayments(lease)}
                        title="התשלומים של השוכר"
                        className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Badge variant={state.badge} className="cursor-pointer">
                          {status.periodLabel ? `${status.periodLabel}: ` : ""}
                          {state.label}
                        </Badge>
                      </button>
                    ) : null}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {[
                      `${formatCurrency(lease.monthlyRentAmount)} ${perPeriod(lease)}`,
                      lease.areaSqm ? `${lease.areaSqm.toLocaleString("he-IL")} מ״ר` : null,
                      [formatShortDate(lease.startDate, ""), lease.endDate ? formatShortDate(lease.endDate, "") : "ללא סיום"]
                        .filter(Boolean)
                        .join(" – "),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button type="button" size="sm" variant="outline" onClick={() => onShowPayments(lease)}>
                    תשלומים
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => onRecord(lease)}>
                    רישום תשלום
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" size="sm" variant="outline" className="h-9 w-9 p-0" aria-label={`פעולות ל${name}`}>
                        <MoreIcon className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onEdit(lease)}>עריכת החוזה</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onSchedule(lease)}>קביעת תשלומים מראש</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onDelete(lease)} className="text-destructive focus:text-destructive">
                        מחיקת החוזה
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {ended.length > 0 ? (
        <details className="group mt-2 text-xs">
          <summary className="flex cursor-pointer list-none items-center gap-1 font-medium text-muted-foreground hover:text-foreground">
            <ChevronDownIcon className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
            חוזים שהסתיימו ({ended.length})
          </summary>
          <ul className="mt-2 space-y-2">
            {ended.map((past) => (
              <li key={past.id} className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className="font-medium">{[past.unitLabel, past.customerName ?? "שוכר"].filter(Boolean).join(" · ")}</span>
                  <div className="text-muted-foreground">
                    {[formatShortDate(past.startDate, ""), formatShortDate(past.endDate, "")].filter(Boolean).join(" – ")}
                    {" · "}
                    {formatCurrency(past.monthlyRentAmount)} {perPeriod(past)}
                  </div>
                </div>
                <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onEdit(past)}>
                  עריכה
                </Button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </CollapsibleSection>
  );
}

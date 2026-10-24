import type { PickedCustomer } from "@/components/customers/CustomerPicker";
import type { LeaseAgreement } from "@/lib/properties";

// Leases saved on the property page with no signal (owner, 2026-10-24): kept on the device and sent with the
// connection — on the page at once meanwhile, as they were saved.

/** What the lease form holds — its fields as text, as typed. */
export type LeaseFormValues = {
  customer: PickedCustomer | null;
  start_date: string;
  end_date: string;
  monthly_rent_amount: string;
  status: string;
  notes: string;
  deposit_type: string;
  deposit_amount: string;
  deposit_reference: string;
  keys_handed_over: string;
  rent_day_of_month: string;
  rent_calendar: string;
  rent_hebrew_day: string;
  period_months: string;
  area_sqm: string;
  unit_label: string;
};

/** A lease as its form saves it (actions.ts's leaseFields) — on the page at once while it waits on the device. */
export function leaseFromForm(
  id: string,
  propertyId: string,
  form: LeaseFormValues,
  before: LeaseAgreement | null,
): LeaseAgreement {
  const num = (value: string) =>
    value.trim() && Number.isFinite(Number(value)) ? Number(value) : null;
  const hebrewDay = Math.round(Number(form.rent_hebrew_day));
  const hebrew =
    form.rent_calendar === "hebrew" && hebrewDay >= 1 && hebrewDay <= 30;
  const rentDay = Math.round(Number(form.rent_day_of_month));
  const area = num(form.area_sqm);
  return {
    id,
    propertyId,
    customerId: form.customer?.id ?? "",
    customerName: form.customer?.name ?? null,
    customerPhone: form.customer?.phone ?? before?.customerPhone ?? null,
    startDate: form.start_date || null,
    endDate: form.end_date || null,
    monthlyRentAmount: Number(form.monthly_rent_amount) || 0,
    documentId: before?.documentId ?? null,
    documentFileName: before?.documentFileName ?? null,
    documentUrl: before?.documentUrl ?? null,
    status: form.status || "active",
    notes: form.notes.trim() || null,
    depositType: form.deposit_type || null,
    depositAmount: num(form.deposit_amount),
    depositReference: form.deposit_reference.trim() || null,
    keysHandedOver: num(form.keys_handed_over),
    rentDayOfMonth: rentDay >= 1 && rentDay <= 31 ? rentDay : null,
    rentCalendar: hebrew ? "hebrew" : "gregorian",
    rentHebrewDay: hebrew ? hebrewDay : null,
    periodMonths: form.period_months === "12" ? 12 : 1,
    areaSqm: area != null && area > 0 ? area : null,
    unitLabel: form.unit_label.trim() || null,
    createdAt: before?.createdAt ?? new Date().toISOString(),
  };
}

/** The page's leases with those saved on the device (no signal yet) in their place, the new ones added. */
export function withSavedLeases(
  leases: LeaseAgreement[],
  saved: LeaseAgreement[],
): LeaseAgreement[] {
  if (saved.length === 0) return leases;
  const byId = new Map(saved.map((lease) => [lease.id, lease]));
  return [
    ...leases.map((lease) => byId.get(lease.id) ?? lease),
    ...saved.filter((s) => !leases.some((l) => l.id === s.id)),
  ];
}

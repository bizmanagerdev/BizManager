import { describe, expect, it } from "vitest";

// A lease saved on the property page with no signal (owner, 2026-10-24): kept
// on the device and sent with the connection — on the page at once meanwhile,
// as it was saved: a new one added, a changed one in its place.

import {
  leaseFromForm,
  withSavedLeases,
  type LeaseFormValues,
} from "@/app/(app)/properties/[id]/savedLeases";
import type { LeaseAgreement } from "@/lib/properties";

const FORM: LeaseFormValues = {
  customer: { id: "c1", name: "דוידוביטש", phone: "050-1234567" },
  start_date: "2026-11-01",
  end_date: "",
  monthly_rent_amount: "4500",
  status: "active",
  notes: " מפתח אצל השכן ",
  deposit_type: "security_check",
  deposit_amount: "9000",
  deposit_reference: "",
  keys_handed_over: "2",
  rent_day_of_month: "",
  rent_calendar: "hebrew",
  rent_hebrew_day: "1",
  period_months: "1",
  area_sqm: "",
  unit_label: "",
};

describe("a lease saved with no signal", () => {
  it("as the form saved it — the same rules as the server's", () => {
    const lease = leaseFromForm("l-new", "p1", FORM, null);
    expect(lease).toMatchObject({
      id: "l-new",
      propertyId: "p1",
      customerId: "c1",
      customerName: "דוידוביטש",
      monthlyRentAmount: 4500,
      startDate: "2026-11-01",
      endDate: null,
      notes: "מפתח אצל השכן",
      depositType: "security_check",
      depositAmount: 9000,
      keysHandedOver: 2,
      rentCalendar: "hebrew",
      rentHebrewDay: 1,
      rentDayOfMonth: null,
      periodMonths: 1,
      areaSqm: null,
      documentId: null,
    });
  });

  it("a changed one keeps its contract", () => {
    const before = {
      ...leaseFromForm("l1", "p1", FORM, null),
      documentId: "d1",
      documentFileName: "חוזה.pdf",
    } as LeaseAgreement;
    const changed = leaseFromForm(
      "l1",
      "p1",
      { ...FORM, monthly_rent_amount: "4700" },
      before,
    );
    expect(changed).toMatchObject({
      monthlyRentAmount: 4700,
      documentId: "d1",
      documentFileName: "חוזה.pdf",
    });
  });

  it("on the page: a changed one in its place, a new one added", () => {
    const old = leaseFromForm("l1", "p1", FORM, null);
    const other = leaseFromForm("l2", "p1", FORM, null);
    const changed = { ...old, monthlyRentAmount: 4700 };
    const added = leaseFromForm("l3", "p1", FORM, null);
    expect(
      withSavedLeases([old, other], [changed, added]).map((l) => [
        l.id,
        l.monthlyRentAmount,
      ]),
    ).toEqual([
      ["l1", 4700],
      ["l2", 4500],
      ["l3", 4500],
    ]);
    expect(withSavedLeases([old], [])).toEqual([old]);
  });
});

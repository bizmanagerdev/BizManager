import { describe, expect, it } from "vitest";
import { rentColumnsFrom } from "@/lib/payments/rent-fields";
import { buildRentSchedule } from "@/lib/rentSchedule";
import {
  hasRenters,
  leaseForPayment,
  nextUncoveredPeriod,
  paymentPeriodLabel,
  renterPayments,
  runningLeases,
  type RentLease,
} from "@/lib/property-rent";
import { rentPeriodChoices, type RentPeriodLease } from "@/lib/rent-periods";

// A rent payment says which month(s) it pays (owner, 2026-10-20): what the
// routes take, the months a form offers, where the next schedule starts, and a
// Hebrew lease's schedule — א׳ of each Hebrew month, 13 in a leap year.

const HEBREW: RentLease = {
  id: "d4",
  status: "active",
  monthlyRentAmount: 4000,
  startDate: "2026-07-15",
  rentCalendar: "hebrew",
  rentHebrewDay: 1,
};
const REGULAR: RentLease = { id: "y15", status: "active", monthlyRentAmount: 8500, startDate: "2026-06-01", rentDayOfMonth: 1 };

describe("the rent fields a payment route takes", () => {
  it("only what's sent — a general income form touches none of them", () => {
    expect(rentColumnsFrom({})).toEqual({});
    expect(rentColumnsFrom({ lease_id: "d4", rent_period_start: "2026-10-12T00:00:00Z", rent_periods: 2 })).toEqual({
      lease_id: "d4",
      rent_period_start: "2026-10-12",
      rent_periods: 2,
    });
  });

  it("not rent clears the lease and the month", () => {
    expect(rentColumnsFrom({ counts_as_rent: false, lease_id: "d4", rent_period_start: "2026-10-12" })).toEqual({
      counts_as_rent: false,
      lease_id: null,
      rent_period_start: null,
      rent_periods: 1,
    });
  });

  it.each([
    [{ rent_periods: 0 }],
    [{ rent_periods: 25 }],
    [{ rent_period_start: "חשון" }],
    [{ counts_as_rent: "yes" }],
    [{ lease_id: 7 }],
  ])("refuses %j", (body) => {
    expect(rentColumnsFrom(body)).toHaveProperty("error");
  });
});

describe("the months a rent form offers", () => {
  it("around the payment, within the lease — never before its first month", () => {
    const choices = rentPeriodChoices(HEBREW, "2026-10-20", 6, 2);
    expect(choices[0]).toBe("2026-07-15"); // א׳ אב — the day the lease started
    expect(choices).toContain("2026-10-12");
    expect(choices.at(-1)).toBe("2026-12-11");
  });

  it("a saved month outside the lease still shows", () => {
    const ended: RentPeriodLease = { ...REGULAR, endDate: "2026-08-31" };
    expect(rentPeriodChoices(ended, "2026-10-05", 2, 1)).toEqual(["2026-08-01", "2026-10-01"]);
  });
});

describe("which lease and month a payment is", () => {
  const leases = [HEBREW as RentLease & { id: string }, REGULAR as RentLease & { id: string }];

  it("the lease it names, else the one running on its date, else the current one", () => {
    expect(leaseForPayment(leases, { date: "2026-10-01", paymentStatus: null, amount: 1, leaseId: "y15" })?.id).toBe("y15");
    expect(leaseForPayment([leases[1]], { date: "2026-10-01", paymentStatus: null, amount: 1 })?.id).toBe("y15");
    expect(leaseForPayment([], { date: "2026-10-01", paymentStatus: null, amount: 1 }, leases[0])?.id).toBe("d4");
    expect(leaseForPayment(leases, { date: "2026-10-01", paymentStatus: null, amount: 1, countsAsRent: false })).toBeNull();
  });

  it("names the month(s) by the lease's calendar", () => {
    expect(paymentPeriodLabel(HEBREW, { date: "2026-10-12", paymentStatus: null, amount: 4000 })).toBe("חשון תשפ״ז");
    expect(
      paymentPeriodLabel(REGULAR, { date: "2026-08-27", paymentStatus: null, amount: 17000, periodStart: "2026-09-01", periods: 2 })
    ).toBe("ספטמבר – אוקטובר 2026");
  });

  it("a payment from before the lease began is for its first month", () => {
    // D4's first check, 15 Mar 2026: the lease began on א׳ ניסן (19 Mar).
    const d4: RentLease = { ...HEBREW, startDate: "2026-03-19" };
    expect(paymentPeriodLabel(d4, { date: "2026-03-15", paymentStatus: "cleared", amount: 4000 })).toBe("ניסן תשפ״ו");
  });

  it("the next schedule starts after the last month paid", () => {
    const paid = [
      { date: "2026-09-12", paymentStatus: "cleared", amount: 4000 },
      { date: "2026-10-12", paymentStatus: "pending", amount: 8000, periodStart: "2026-10-12", periods: 2 },
      { date: "2027-01-01", paymentStatus: "rejected", amount: 4000, periodStart: "2027-01-09" },
    ];
    expect(nextUncoveredPeriod(HEBREW, paid, "2026-10-20")).toBe("2026-12-11"); // א׳ טבת
    expect(nextUncoveredPeriod(HEBREW, [], "2026-10-20")).toBe("2026-10-12");
  });
});

describe("a schedule that follows its lease", () => {
  it("a Hebrew lease: one row on א׳ of each month — 13 in the leap year — each saying its month", () => {
    const rows = buildRentSchedule({ firstMonth: "2026-09-12", count: 13, monthlyAmount: 4000, lease: HEBREW });
    expect(rows).toHaveLength(13);
    expect(rows.slice(0, 3).map((r) => [r.paymentDate, r.periodStart])).toEqual([
      ["2026-09-12", "2026-09-12"],
      ["2026-10-12", "2026-10-12"],
      ["2026-11-11", "2026-11-11"],
    ]);
    expect(rows.map((r) => r.paymentDate)).toEqual(expect.arrayContaining(["2027-02-08", "2027-03-10"]));
  });

  it("stops at the lease's end", () => {
    const rows = buildRentSchedule({ firstMonth: "2027-04-08", count: 12, monthlyAmount: 4000, lease: { ...HEBREW, endDate: "2027-06-06" } });
    expect(rows.map((r) => r.paymentDate)).toEqual(["2027-04-08", "2027-05-08", "2027-06-06"]);
  });

  it("without a lease it's a month apart, as before", () => {
    const rows = buildRentSchedule({ firstMonth: "2026-01-31", count: 2, monthlyAmount: 100 });
    expect(rows.map((r) => [r.paymentDate, r.periodStart])).toEqual([
      ["2026-01-31", undefined],
      ["2026-02-28", undefined],
    ]);
  });
});

describe("a property with renters (a storage room, or two leases at once)", () => {
  it("lists them for a storage property even with one; any other once two run", () => {
    expect(hasRenters("storage", 0)).toBe(true);
    expect(hasRenters("apartment", 1)).toBe(false);
    expect(hasRenters("apartment", 2)).toBe(true);
  });

  it("running: active and not ended", () => {
    const leases = [
      { id: "a", status: "active", endDate: null },
      { id: "b", status: "active", endDate: "2026-09-30" },
      { id: "c", status: "ended", endDate: null },
    ];
    expect(runningLeases(leases, "2026-10-20").map((l) => l.id)).toEqual(["a"]);
  });

  it("each renter's rent is what says it's theirs; one that says nothing only when there's one renter", () => {
    const payments = [{ leaseId: "a" }, { leaseId: "b" }, { leaseId: null }, { leaseId: "a", countsAsRent: false }];
    expect(renterPayments("a", payments, false)).toEqual([{ leaseId: "a" }]);
    expect(renterPayments("a", payments, true)).toEqual([{ leaseId: "a" }, { leaseId: null }]);
  });
});

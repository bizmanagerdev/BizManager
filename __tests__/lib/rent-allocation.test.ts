import { describe, expect, it } from "vitest";
import {
  allocateRent,
  nextUncoveredPeriod,
  paidTowards,
  paymentPeriodLabel,
  rentAllocationOf,
  rentPeriodStatus,
  type RentLease,
  type RentPayment,
} from "@/lib/property-rent";
import { allocationMismatch, rentColumnsFrom, rescaleAllocation } from "@/lib/payments/rent-fields";

// A payment for months ticked one by one (owner, 2026-10-22: "what happens when
// a renter transfers money for a few months at once either ahead or back … I
// choose what months it will cover"): the money fills them oldest first, and
// each payment says how much went to each (payments.rent_allocation).

const LEASE: RentLease = { id: "y15", status: "active", monthlyRentAmount: 4000, startDate: "2026-06-01", rentDayOfMonth: 1 };
const paid = (extra: Partial<RentPayment>): RentPayment => ({ date: "2026-10-05", paymentStatus: "cleared", amount: 4000, leaseId: "y15", ...extra });

describe("money into months, oldest first", () => {
  it("₪10,000 for three months of ₪4,000: ₪4,000, ₪4,000 and ₪2,000 — the last ₪2,000 short", () => {
    const months = ["2026-11-01", "2026-12-01", "2027-01-01"].map((period) => ({ period, need: 4000 }));
    expect(allocateRent([10000], months)).toEqual({
      shares: [
        [
          { period: "2026-11-01", amount: 4000 },
          { period: "2026-12-01", amount: 4000 },
          { period: "2027-01-01", amount: 2000 },
        ],
      ],
      short: 2000,
      extra: 0,
    });
  });

  it("a month part-paid only gets what it's missing; months come oldest first however they were ticked", () => {
    const { shares } = allocateRent([5000], [
      { period: "2026-10-01", need: 4000 },
      { period: "2026-09-01", need: 1000 },
    ]);
    expect(shares).toEqual([
      [
        { period: "2026-09-01", amount: 1000 },
        { period: "2026-10-01", amount: 4000 },
      ],
    ]);
  });

  it("several payments fill the months in turn, one picking up where the other stopped", () => {
    const { shares, short } = allocateRent([1000, 5000], [
      { period: "2026-09-01", need: 4000 },
      { period: "2026-10-01", need: 4000 },
    ]);
    expect(shares).toEqual([
      [{ period: "2026-09-01", amount: 1000 }],
      [
        { period: "2026-09-01", amount: 3000 },
        { period: "2026-10-01", amount: 2000 },
      ],
    ]);
    expect(short).toBe(2000);
  });

  it("more than the months need: what's left over", () => {
    expect(allocateRent([4500], [{ period: "2026-11-01", need: 4000 }])).toMatchObject({ short: 0, extra: 500 });
  });
});

describe("a payment that says its months", () => {
  const ticked = paid({
    amount: 7000,
    periodStart: "2026-09-01",
    periods: 3,
    allocation: [
      { period: "2026-09-01", amount: 1000 },
      { period: "2026-11-01", amount: 4000 },
      { period: "2026-12-01", amount: 2000 },
    ],
  });

  it("pays each month what it was given — not an even third, and nothing for the month it skipped", () => {
    expect(paidTowards(LEASE, ticked, "2026-09-01")).toBe(1000);
    expect(paidTowards(LEASE, ticked, "2026-10-01")).toBe(0);
    expect(paidTowards(LEASE, ticked, "2026-12-01")).toBe(2000);
    expect(rentPeriodStatus(LEASE, [ticked], "2026-12-01", "2026-10-22")).toMatchObject({ state: "partial", collected: 2000 });
  });

  it("its months in words, and the month after its last", () => {
    expect(paymentPeriodLabel(LEASE, ticked)).toBe("ספטמבר, נובמבר – דצמבר 2026");
    expect(nextUncoveredPeriod(LEASE, [ticked], "2026-10-22")).toBe("2027-01-01");
  });

  it("one that doesn't is split evenly over its run, as before", () => {
    const two = paid({ amount: 8000, periodStart: "2026-11-01", periods: 2 });
    expect(paidTowards(LEASE, two, "2026-11-01")).toBe(4000);
    expect(paidTowards(LEASE, two, "2026-12-01")).toBe(4000);
  });

  it("read from the server (a list) or the device (its JSON text); anything else: none", () => {
    const list = [{ period: "2026-11-01", amount: 4000 }];
    expect(rentAllocationOf(list)).toEqual(list);
    expect(rentAllocationOf(JSON.stringify(list))).toEqual(list);
    expect(rentAllocationOf(null)).toBeNull();
    expect(rentAllocationOf("not json")).toBeNull();
    expect(rentAllocationOf([])).toBeNull();
  });
});

describe("the months a route takes", () => {
  it("ticked months: in order, and they say where it starts and how many", () => {
    const rent = rentColumnsFrom({
      lease_id: "y15",
      rent_allocation: [
        { period: "2026-11-01", amount: 4000 },
        { period: "2026-09-01T00:00:00Z", amount: "1000" },
      ],
    });
    expect(rent).toEqual({
      lease_id: "y15",
      rent_allocation: [
        { period: "2026-09-01", amount: 1000 },
        { period: "2026-11-01", amount: 4000 },
      ],
      rent_period_start: "2026-09-01",
      rent_periods: 2,
    });
    expect(allocationMismatch(rent as never, 5000)).toBeNull();
    expect(allocationMismatch(rent as never, 6000)).not.toBeNull();
  });

  it("months set the old way drop the ticked ones; not rent drops them too", () => {
    expect(rentColumnsFrom({ rent_period_start: "2026-11-01", rent_periods: 2 })).toMatchObject({ rent_allocation: null });
    expect(rentColumnsFrom({ counts_as_rent: false })).toMatchObject({ rent_allocation: null });
    expect(rentColumnsFrom({ notes: "x" } as never)).toEqual({});
  });

  it.each([
    [[]],
    [[{ period: "חשון", amount: 4000 }]],
    [[{ period: "2026-11-01", amount: 0 }]],
    [[{ period: "2026-11-01", amount: 1 }, { period: "2026-11-01", amount: 2 }]],
    ["2026-11-01"],
  ])("refuses %j", (value) => {
    expect(rentColumnsFrom({ rent_allocation: value })).toHaveProperty("error");
  });

  it("a new amount from a page that knows nothing of the months: the same months, each its share", () => {
    const shares = [
      { period: "2026-09-01", amount: 1000 },
      { period: "2026-11-01", amount: 4000 },
      { period: "2026-12-01", amount: 2000 },
    ];
    expect(rescaleAllocation(shares, 3500)).toEqual([
      { period: "2026-09-01", amount: 500 },
      { period: "2026-11-01", amount: 2000 },
      { period: "2026-12-01", amount: 1000 },
    ]);
    // Unchanged, or never ticked: nothing to write.
    expect(rescaleAllocation(shares, 7000)).toBeNull();
    expect(rescaleAllocation(null, 7000)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import type { LeaseAgreement, RentRollData, RentRollPayment, RentRollProperty } from "@/lib/properties";
import { rentRollMonth, rentRollOffsetFor, rentRollToday, rentRollYear, rentRowOwes } from "@/lib/rent-roll";
import { shiftRentPeriod, type RentPeriodLease } from "@/lib/rent-periods";

// The rent roll (owner, 2026-10-21): every lease's rent for one month, each
// lease by its own calendar — חשון for one paid on א׳ of the Hebrew month,
// October for one paid on the 1st.

const TODAY = "2026-10-21";

function property(id: string, sortOrder: number, extra: Partial<RentRollProperty> = {}): RentRollProperty {
  return { id, name: id, address: `${id} st`, propertyType: "apartment", isActive: true, sortOrder, ...extra };
}

function lease(id: string, propertyId: string, extra: Partial<LeaseAgreement> = {}): LeaseAgreement {
  return {
    id,
    propertyId,
    customerId: `c-${id}`,
    customerName: `tenant ${id}`,
    customerPhone: null,
    startDate: "2026-06-01",
    endDate: null,
    monthlyRentAmount: 4000,
    documentId: null,
    documentFileName: null,
    documentUrl: null,
    status: "active",
    notes: null,
    depositType: null,
    depositAmount: null,
    depositReference: null,
    keysHandedOver: null,
    rentDayOfMonth: 1,
    rentCalendar: "gregorian",
    rentHebrewDay: null,
    periodMonths: 1,
    areaSqm: null,
    unitLabel: null,
    createdAt: null,
    ...extra,
  };
}

function payment(id: string, propertyId: string, extra: Partial<RentRollPayment> = {}): RentRollPayment {
  return {
    id,
    propertyId,
    date: "2026-10-01",
    amount: 4000,
    method: "bank_transfer",
    dueDate: null,
    checkNumber: null,
    paymentStatus: "cleared",
    tornAt: null,
    rentAllocation: null,
    accountId: null,
    notes: null,
    referenceNumber: null,
    requiresSplit: false,
    createdAt: null,
    leaseId: null,
    rentPeriodStart: null,
    rentPeriods: 1,
    countsAsRent: true,
    attachments: [],
    ...extra,
  };
}

// D4: on א׳ of the Hebrew month from א׳ ניסן תשפ״ו; יהודה הנשיא: on the 1st.
const HEBREW = lease("heb", "d4", { startDate: "2026-03-19", rentCalendar: "hebrew", rentHebrewDay: 1, rentDayOfMonth: null });
const REGULAR = lease("greg", "yehuda", { monthlyRentAmount: 8500, endDate: "2026-12-31" });

function data(extra: Partial<RentRollData> = {}): RentRollData {
  return {
    properties: [property("d4", 1), property("yehuda", 2)],
    leases: [HEBREW, REGULAR],
    payments: [],
    accountNames: {},
    ...extra,
  };
}

describe("the month", () => {
  it("is each lease's own: חשון for the Hebrew one, October for the regular one", () => {
    const month = rentRollMonth(data(), 0, TODAY);
    expect(month.rows.map((r) => [r.key, r.period])).toEqual([
      ["heb", "2026-10-12"],
      ["greg", "2026-10-01"],
    ]);
    expect(month.label).toBe("אוקטובר 2026 · חשון תשפ״ז");
    expect(month.rows[0].dueLabel).toBe("א׳ חשון");
    expect(month.rows[1].dueLabel).toBe("1.10");
  });

  it("steps back and on by each lease's own periods", () => {
    expect(rentRollMonth(data(), -1, TODAY).rows.map((r) => r.period)).toEqual(["2026-09-12", "2026-09-01"]);
    expect(rentRollMonth(data(), 1, TODAY).rows.map((r) => r.period)).toEqual(["2026-11-11", "2026-11-01"]);
  });

  it("goes through a Hebrew leap year's 13 months, none skipped or twice", () => {
    const only = data({ leases: [HEBREW], properties: [property("d4", 1)] });
    const periods = Array.from({ length: 13 }, (_, i) => rentRollMonth(only, i - 1, TODAY).rows[0].period);
    expect(new Set(periods).size).toBe(13);
    expect(periods).toContain("2027-02-08"); // אדר א׳
    expect(periods).toContain("2027-03-10"); // אדר ב׳
    expect([...periods].sort()).toEqual(periods);
  });

  it("shows a lease only in its own months: not before its first, not after its end", () => {
    const future = lease("new", "d5", { startDate: "2026-12-01" });
    const ended = lease("old", "d6", { startDate: "2026-01-01", endDate: "2026-08-31", status: "ended" });
    const cancelled = lease("never", "d7", { status: "cancelled" });
    const set = data({
      properties: [property("d5", 3), property("d6", 4), property("d7", 5)],
      leases: [future, ended, cancelled],
    });
    expect(rentRollMonth(set, 0, TODAY).rows).toEqual([]);
    expect(rentRollMonth(set, 2, TODAY).rows.map((r) => r.key)).toEqual(["new"]);
    expect(rentRollMonth(set, -2, TODAY).rows.map((r) => r.key)).toEqual(["old"]);
  });

  it("leaves out a property no longer active", () => {
    const month = rentRollMonth(data({ properties: [property("d4", 1, { isActive: false }), property("yehuda", 2)] }), 0, TODAY);
    expect(month.rows.map((r) => r.key)).toEqual(["greg"]);
  });

  it("shows a yearly lease in the month its year is due, and not the others", () => {
    const yearly = lease("year", "store", { startDate: "2026-11-05", rentDayOfMonth: 5, periodMonths: 12, monthlyRentAmount: 12000 });
    const set = data({ properties: [property("yehuda", 1), property("store", 2)], leases: [REGULAR, yearly] });
    expect(rentRollMonth(set, 0, TODAY).rows.map((r) => r.key)).toEqual(["greg"]);
    const november = rentRollMonth(set, 1, TODAY);
    expect(november.rows.map((r) => [r.key, r.period])).toEqual([
      ["greg", "2026-11-01"],
      ["year", "2026-11-05"],
    ]);
  });
});

describe("who paid", () => {
  it("a month paid, one not: the totals say what's in and what's still owed", () => {
    const paid = payment("p1", "d4", { leaseId: "heb", rentPeriodStart: "2026-10-12", date: "2026-10-12" });
    // D4's from this חשון, so nothing before it owes.
    const month = rentRollMonth(data({ leases: [{ ...HEBREW, startDate: "2026-10-12" }, REGULAR], payments: [paid] }), 0, TODAY);
    const [d4, yehuda] = month.rows;
    expect(d4.status.state).toBe("paid");
    expect(d4.payments.map((p) => p.id)).toEqual(["p1"]);
    expect(yehuda.status.state).toBe("late");
    expect(yehuda.owed).toBe(8500);
    expect(month.totals).toMatchObject({ expected: 12500, collected: 4000, collectedByCheck: 0, checks: 0, owed: 8500 });
    expect(rentRowOwes(d4)).toBe(false);
    expect(rentRowOwes(yehuda)).toBe(true);
  });

  it("a check cleared: in, and counted as came by check", () => {
    const cleared = payment("c2", "yehuda", { method: "check", amount: 8500, leaseId: "greg", rentPeriodStart: "2026-10-01" });
    const month = rentRollMonth(data({ payments: [cleared] }), 0, TODAY);
    expect(month.totals).toMatchObject({ collected: 8500, collectedByCheck: 8500, checks: 0 });
  });

  it("a check waiting for the month: in hand, not owed", () => {
    const check = payment("c1", "yehuda", {
      method: "check",
      paymentStatus: "pending",
      amount: 8500,
      leaseId: "greg",
      rentPeriodStart: "2026-10-01",
      dueDate: "2026-10-25",
    });
    const row = rentRollMonth(data({ payments: [check] }), 0, TODAY).rows[1];
    expect(row.status.state).toBe("check");
    expect(row.owed).toBe(0);
    expect(rentRollMonth(data({ payments: [check] }), 0, TODAY).totals.checks).toBe(8500);
  });

  it("a payment for two months pays half of each", () => {
    const two = payment("p2", "yehuda", { amount: 17000, leaseId: "greg", rentPeriodStart: "2026-10-01", rentPeriods: 2 });
    expect(rentRollMonth(data({ payments: [two] }), 0, TODAY).rows[1].status).toMatchObject({ state: "paid", collected: 8500 });
    expect(rentRollMonth(data({ payments: [two] }), 1, TODAY).rows[1].status).toMatchObject({ state: "paid", collected: 8500 });
  });

  it("a storage spot's rent never counts for the apartment beside it", () => {
    const storage = lease("spot", "d4", { unitLabel: "מחסן", monthlyRentAmount: 500, startDate: "2026-06-01" });
    const spotRent = payment("s1", "d4", { amount: 500, leaseId: "spot", rentPeriodStart: "2026-10-01" });
    const month = rentRollMonth(data({ leases: [HEBREW, storage, REGULAR], payments: [spotRent] }), 0, TODAY);
    expect(month.rows.find((r) => r.key === "heb")?.status.collected).toBe(0);
    expect(month.rows.find((r) => r.key === "spot")?.status.state).toBe("paid");
  });

  it("a rejected check doesn't pay, and income that isn't rent doesn't either", () => {
    const rejected = payment("r1", "yehuda", { leaseId: "greg", rentPeriodStart: "2026-10-01", amount: 8500, paymentStatus: "rejected" });
    const refund = payment("x1", "yehuda", { leaseId: null, amount: 8500, countsAsRent: false });
    expect(rentRollMonth(data({ payments: [rejected, refund] }), 0, TODAY).rows[1].status.state).toBe("late");
  });

  it("a month before not paid is its own debt — this month still reads paid", () => {
    // June to September unpaid, October paid (owner, 2026-10-21: "it looks like they didn't pay this month").
    const october = payment("o1", "yehuda", { leaseId: "greg", rentPeriodStart: "2026-10-01", amount: 8500 });
    const july = payment("j1", "yehuda", { leaseId: "greg", rentPeriodStart: "2026-07-01", amount: 3000 });
    const month = rentRollMonth(data({ properties: [property("yehuda", 1)], leases: [REGULAR], payments: [october, july] }), 0, TODAY);
    const [row] = month.rows;
    expect(row.status.state).toBe("paid");
    expect(row.owed).toBe(0);
    // June 142 days, July 112, August 81, September 50 days ago.
    expect(row.debt).toEqual({ amount: 8500 * 4 - 3000, periods: 4, upTo30: 0, upTo60: 8500, over60: 8500 * 3 - 3000, oldest: "2026-06-01" });
    expect(month.totals.debt).toBe(8500 * 4 - 3000);
    expect(rentRowOwes(row)).toBe(true);
  });

  it("a month not due yet is no debt", () => {
    const month = rentRollMonth(data({ properties: [property("yehuda", 1)], leases: [{ ...REGULAR, startDate: "2026-10-01" }] }), 2, TODAY);
    // December's row: October is past due, November not yet.
    expect(month.rows[0].debt.periods).toBe(1);
  });

  it("the post-dated checks still in hand, and the last month they reach", () => {
    const checks = ["2026-11-11", "2026-12-11", "2027-01-09"].map((start, i) =>
      payment(`k${i}`, "d4", { method: "check", paymentStatus: "pending", leaseId: "heb", rentPeriodStart: start, dueDate: start })
    );
    const row = rentRollMonth(data({ payments: checks }), 0, TODAY).rows[0];
    expect(row.checksInHand).toEqual({ count: 3, amount: 12000, lastPeriod: "2027-01-09", lastLabel: "שבט תשפ״ז" });
    expect(rentRollMonth(data({ payments: checks }), 0, TODAY).totals.checksInHand).toEqual({ count: 3, amount: 12000 });
  });

  it("a check that came back pays nothing, and shows as returned", () => {
    const bounced = payment("b1", "d4", { method: "check", checkNumber: "262", paymentStatus: "rejected", leaseId: "heb", rentPeriodStart: "2026-10-12" });
    const row = rentRollMonth(data({ payments: [bounced] }), 0, TODAY).rows[0];
    expect(row.status.state).toBe("late");
    expect(row.payments).toEqual([]);
    expect(row.returned.map((p) => p.checkNumber)).toEqual(["262"]);
    expect(row.torn).toEqual([]);
  });

  it("a check torn up because a transfer paid its month: the month paid, the check torn — not returned", () => {
    const torn = payment("t1", "d4", { method: "check", checkNumber: "262", paymentStatus: "rejected", tornAt: "2026-10-22T09:00:00.000Z", leaseId: "heb", rentPeriodStart: "2026-10-12" });
    const transfer = payment("x1", "d4", { method: "bank_transfer", amount: 4000, leaseId: "heb", rentPeriodStart: "2026-10-12" });
    const row = rentRollMonth(data({ payments: [torn, transfer] }), 0, TODAY).rows[0];
    expect(row.status.state).toBe("paid");
    expect(row.payments.map((p) => p.id)).toEqual(["x1"]);
    expect(row.returned).toEqual([]);
    expect(row.torn.map((p) => p.checkNumber)).toEqual(["262"]);
    expect(rentRollToday(data({ payments: [torn, transfer] }), TODAY).todo.some((t) => t.kind === "bounced")).toBe(false);
  });

  it("an active property with no lease that month: no tenant", () => {
    const month = rentRollMonth(data({ properties: [property("d4", 1), property("yehuda", 2), property("empty", 3), property("sold", 4, { isActive: false })] }), 0, TODAY);
    expect(month.vacant.map((p) => p.id)).toEqual(["empty"]);
  });
});

describe("the rent alert's link", () => {
  it("opens the month its period is in", () => {
    expect(rentRollOffsetFor(data(), "heb", "2026-11-11", TODAY)).toBe(1);
    expect(rentRollOffsetFor(data(), "greg", "2026-08-01", TODAY)).toBe(-2);
    expect(rentRollOffsetFor(data(), "heb", "2030-01-01", TODAY)).toBe(0);
  });
});

describe("shiftRentPeriod", () => {
  const hebrew: RentPeriodLease = { startDate: "2026-03-19", rentCalendar: "hebrew", rentHebrewDay: 1 };
  it("moves on and back by the lease's own periods", () => {
    expect(shiftRentPeriod(hebrew, "2026-10-12", 1)).toBe("2026-11-11");
    expect(shiftRentPeriod(hebrew, "2026-10-12", -1)).toBe("2026-09-12");
    expect(shiftRentPeriod(hebrew, "2026-10-12", 0)).toBe("2026-10-12");
    expect(shiftRentPeriod(hebrew, shiftRentPeriod(hebrew, "2026-10-12", -5), 5)).toBe("2026-10-12");
  });
});

describe("the year at a glance", () => {
  it("twelve months around the one in view — each lease a row, a cell for each month it runs", () => {
    const paid = payment("p1", "d4", { leaseId: "heb", rentPeriodStart: "2026-10-12" });
    const year = rentRollYear(data({ payments: [paid] }), 0, TODAY);
    expect(year.offsets).toEqual([-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6]);
    expect(year.headers[5]).toBe("אוקטובר / חשון");
    expect(year.rows.map((r) => r.key)).toEqual(["heb", "greg"]);
    const d4 = year.rows[0];
    expect(d4.cells[5]?.status.state).toBe("paid");
    // יהודה הנשיא's lease ends with December: no cell after it.
    const yehuda = year.rows[1];
    expect(yehuda.cells[7]?.period).toBe("2026-12-01");
    expect(yehuda.cells[8]).toBeNull();
  });
});

describe("today: what to do, the four figures, the most urgent first", () => {
  it("rent late, old debt, a lease ending, no tenant — each a line; the late one first", () => {
    const julyShort = payment("j1", "yehuda", { leaseId: "greg", rentPeriodStart: "2026-07-01", amount: 8000 });
    const paidOthers = ["2026-06-01", "2026-08-01", "2026-09-01"].map((start, i) =>
      payment(`g${i}`, "yehuda", { leaseId: "greg", rentPeriodStart: start, amount: 8500 })
    );
    const d4 = payment("p1", "d4", { leaseId: "heb", rentPeriodStart: "2026-10-12", date: "2026-10-12" });
    const set = data({
      properties: [property("d4", 1), property("yehuda", 2), property("empty", 3)],
      leases: [{ ...HEBREW, startDate: "2026-10-12" }, REGULAR],
      payments: [julyShort, ...paidOthers, d4],
    });
    const today = rentRollToday(set, TODAY);
    // יהודה הנשיא: October late (20 days), July ₪500 short; D4 paid.
    expect(today.rows.map((r) => r.key)).toEqual(["greg", "heb"]);
    expect(today.todo.map((t) => t.kind)).toEqual(["late", "debt", "leaseEnd", "vacant"]);
    const late = today.todo[0];
    expect(late.kind === "late" && late.days).toBe(20);
    expect(today.tiles.collected).toEqual({ amount: 4000, expected: 12500, paid: 1, tenants: 2, waitingChecks: 0 });
    expect(today.tiles.late).toEqual({ amount: 9000, tenants: 1, upTo30: 8500, upTo60: 0, over60: 500 });
    expect(today.rows[0].debt.oldest).toBe("2026-07-01");
  });

  it("checks to deposit: those whose day has come, and the week's; checks running out ask for more", () => {
    const due = payment("c1", "d4", { method: "check", paymentStatus: "pending", leaseId: "heb", rentPeriodStart: "2026-10-12", dueDate: "2026-10-20" });
    const week = payment("c2", "yehuda", { method: "check", paymentStatus: "pending", amount: 8500, leaseId: "greg", rentPeriodStart: "2026-10-01", dueDate: "2026-10-25" });
    const today = rentRollToday(data({ payments: [due, week] }), TODAY);
    const deposit = today.todo.find((t) => t.kind === "deposit");
    expect(deposit && deposit.kind === "deposit" && [deposit.due.map((p) => p.id), deposit.week.map((p) => p.id)]).toEqual([["c1"], ["c2"]]);
    expect(today.tiles.deposit).toEqual({ count: 2, amount: 12500, overdue: 1, next: null });
    // Both pay by check and have no checks for the months after this one.
    expect(today.todo.filter((t) => t.kind === "checksLow").length).toBe(2);
  });

  it("nothing to do says so: everything paid, checks in hand to the lease's end", () => {
    const year = ["2026-10-12", "2026-11-11", "2026-12-11", "2027-01-09"].map((start, i) =>
      payment(`k${i}`, "d4", {
        method: "check",
        paymentStatus: i === 0 ? "cleared" : "pending",
        leaseId: "heb",
        rentPeriodStart: start,
        dueDate: start,
      })
    );
    const set = data({
      properties: [property("d4", 1)],
      leases: [{ ...HEBREW, startDate: "2026-10-12", endDate: "2027-01-15" }],
      payments: year,
    });
    const today = rentRollToday(set, TODAY);
    expect(today.todo.map((t) => t.kind)).toEqual(["leaseEnd"]);
    expect(today.tiles.inHand.count).toBe(3);
    expect(today.tiles.inHand.firstOut?.label).toBe("שבט תשפ״ז");
  });

  it("the year's last line: each month's share collected, of what's due", () => {
    const paid = payment("p1", "d4", { leaseId: "heb", rentPeriodStart: "2026-10-12" });
    const year = rentRollYear(data({ payments: [paid] }), 0, TODAY);
    // October: D4 paid ₪4,000 of ₪12,500 due; the months ahead: none due yet.
    expect(Math.round((year.rates[5] ?? 0) * 100)).toBe(32);
    expect(year.rates[6]).toBeNull();
  });
});

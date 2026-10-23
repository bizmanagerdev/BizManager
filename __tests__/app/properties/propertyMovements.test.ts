import { describe, expect, it, vi } from "vitest";
import {
  buildPropertyMovements,
  paymentTitle,
  rentMonthLabel,
  type PropertyMovementInput,
} from "@/app/(app)/properties/[id]/propertyMovements";
import { rentThisPeriod } from "@/lib/property-rent";
import { donutSlices } from "@/components/charts/CategoryDonut";
import type { LeaseAgreement, PropertyExpense, PropertyPayment, PropertySession } from "@/lib/properties";

// The property page as one details page (owner, 2026-10-20): every income in
// one list whatever it was paid with, titled by its note; what's still to come
// in its own list; this month's rent; and where the money went.

function payment(fields: Partial<PropertyPayment>): PropertyPayment {
  return {
    id: "p1",
    date: "2026-08-01T00:00:00+00:00",
    amount: 8500,
    method: "bank_transfer",
    dueDate: null,
    checkNumber: null,
    paymentStatus: "cleared",
    tornAt: null,
    rentAllocation: null,
    accountId: "acc-1",
    notes: null,
    referenceNumber: null,
    requiresSplit: false,
    createdAt: null,
    leaseId: null,
    rentPeriodStart: null,
    rentPeriods: 1,
    countsAsRent: true,
    attachments: [],
    ...fields,
  };
}

function expense(fields: Partial<PropertyExpense>): PropertyExpense {
  return {
    id: "e1",
    date: "2026-09-01",
    amount: 1200,
    category: "משכנתא",
    description: "משכנתא לאומי",
    paymentStatus: "paid",
    businessDomain: "property_management",
    notes: null,
    paymentMethod: "bank_transfer",
    accountId: null,
    paidAmount: null,
    projectId: null,
    orderId: null,
    propertyId: "prop-1",
    recurringTemplateId: null,
    attachments: [],
    ...fields,
  };
}

function input(fields: Partial<PropertyMovementInput>): PropertyMovementInput {
  return {
    payments: [],
    expenses: [],
    sessions: [],
    sessionAttachments: {},
    accountNames: { "acc-1": "מזרחי בית" },
    templateNameById: new Map(),
    users: [{ id: "u1", label: "דנה", payrollWorkerType: null, payTrackingMode: null }],
    onEditPayment: vi.fn(),
    onDeletePayment: vi.fn(),
    onToggleCleared: vi.fn(),
    onCheckArrived: vi.fn(),
    onPaidInstead: vi.fn(),
    onEditExpense: vi.fn(),
    onDeleteExpense: vi.fn(),
    onEditSession: vi.fn(),
    onDeleteSession: vi.fn(),
    ...fields,
  };
}

describe("an income's title", () => {
  it("is what was written for it — not the payment method", () => {
    expect(paymentTitle(payment({ notes: "שכירות חודש אב" }))).toBe("שכירות חודש אב");
    expect(paymentTitle(payment({ notes: "שולם לחודשיים\nפרטים" }))).toBe("שולם לחודשיים");
  });

  it("a check from the rent schedule reads by its month, not a raw date", () => {
    expect(rentMonthLabel("2026-11-01T00:00:00+00:00")).toBe("נובמבר 2026");
    expect(paymentTitle(payment({ method: "check", date: "2026-11-01T00:00:00+00:00" }))).toBe("שכירות נובמבר 2026");
  });

  it("nothing written: just הכנסה", () => {
    expect(paymentTitle(payment({}))).toBe("הכנסה");
  });
});

describe("the property's money table", () => {
  it("rent paid by transfer or cash is in the one list, with its method in Hebrew and its account", () => {
    const { done, expected } = buildPropertyMovements(
      input({ payments: [payment({ notes: "שכירות חודש אב" }), payment({ id: "p2", method: "cash", date: "2026-06-01" })] })
    );
    expect(expected).toHaveLength(0);
    expect(done.map((m) => [m.name, m.hint, m.account])).toEqual([
      ["הכנסה", "מזומן", "מזרחי בית"],
      ["שכירות חודש אב", "העברה בנקאית", "מזרחי בית"],
    ]);
  });

  it("rent says the month(s) it pays by its lease's calendar; a refund says it isn't rent", () => {
    const hebrew = {
      id: "l1",
      status: "active",
      monthlyRentAmount: 4000,
      startDate: "2026-07-15",
      rentCalendar: "hebrew",
      rentHebrewDay: 1,
      periodMonths: 1,
    } as LeaseAgreement;
    const { done } = buildPropertyMovements(
      input({
        leases: [hebrew],
        currentLease: hebrew,
        payments: [
          payment({ id: "a", date: "2026-10-12", leaseId: "l1", rentPeriodStart: "2026-10-12", rentPeriods: 2 }),
          payment({ id: "b", date: "2026-09-14", method: "check", amount: 4000 }),
          payment({ id: "c", date: "2026-10-06", amount: 300000, notes: "החזר", countsAsRent: false }),
        ],
      })
    );
    const row = (key: string) => done.find((m) => m.key === `payment:${key}`);
    expect(row("a")?.name).toBe("שכירות חשון – כסלו תשפ״ז");
    expect(row("a")?.extras).toContainEqual({ label: "לחודשים", value: "חשון – כסלו תשפ״ז" });
    // An older check, saved before it said its month: the Hebrew month of its date.
    expect(row("b")?.extras).toContainEqual({ label: "לחודש", value: "תשרי תשפ״ז" });
    expect(row("c")?.extras).toContainEqual({ label: "סוג", value: "לא שכירות" });
  });

  it("a check not yet cleared is expected, on its due date, with נפרע in its menu", () => {
    const onCheckArrived = vi.fn();
    const check = payment({ id: "c1", method: "check", paymentStatus: "pending", date: "2026-12-01", dueDate: "2026-12-05", checkNumber: "1001" });
    const { done, expected } = buildPropertyMovements(input({ payments: [check], onCheckArrived }));
    expect(done).toHaveLength(0);
    expect(expected[0]).toMatchObject({ name: "שכירות דצמבר 2026", date: "2026-12-05", hint: "צ׳ק #1001" });
    expect(expected[0].actions?.map((a) => a.label)).toEqual(["נפרע", "שולם אחרת החודש (העברה / מזומן)"]);
    expected[0].actions?.[0].onSelect();
    expect(onCheckArrived).toHaveBeenLastCalledWith(check, "שכירות דצמבר 2026");
  });

  it("a check that's in: ביטול הסימון", () => {
    const onToggleCleared = vi.fn();
    const check = payment({ id: "c1", method: "check", paymentStatus: "cleared", date: "2026-12-01", dueDate: "2026-12-05" });
    const { done } = buildPropertyMovements(input({ payments: [check], onToggleCleared }));
    expect(done[0].actions?.map((a) => a.label)).toEqual(["ביטול הסימון"]);
    done[0].actions?.[0].onSelect();
    expect(onToggleCleared).toHaveBeenCalledWith(check);
  });

  it("an unpaid bill is expected; a paid one, a shift and the incomes are in the table, oldest first", () => {
    const shift = { id: "s1", user_id: "u1", clock_in: "2026-08-15T07:00:00Z", clock_out: null, labor_cost: 300 } as unknown as PropertySession;
    const { done, expected } = buildPropertyMovements(
      input({
        payments: [payment({ date: "2026-09-10" })],
        expenses: [expense({}), expense({ id: "e2", paymentStatus: "not_paid", date: "2026-10-01", description: "ארנונה" })],
        sessions: [shift],
      })
    );
    expect(done.map((m) => m.key)).toEqual(["session:s1", "expense:e1", "payment:p1"]);
    expect(done[0]).toMatchObject({ category: "שכר עובד", name: "דנה", direction: "out" });
    expect(expected.map((m) => m.name)).toEqual(["ארנונה"]);
  });

  it("a generated expense reads by its template's name", () => {
    const { done } = buildPropertyMovements(
      input({ expenses: [expense({ recurringTemplateId: "t1" })], templateNameById: new Map([["t1", "הלוואה אמא 1"]]) })
    );
    expect(done[0].name).toBe("הלוואה אמא 1");
  });
});

describe("this period's rent", () => {
  const lease = {
    id: "l1",
    status: "active",
    monthlyRentAmount: 8500,
    rentDayOfMonth: 1,
    startDate: "2026-06-01",
    rentCalendar: "gregorian",
  } as LeaseAgreement;
  const rent = (p: PropertyPayment) => ({
    date: p.date,
    paymentStatus: p.paymentStatus,
    amount: p.amount,
    leaseId: p.leaseId,
    periodStart: p.rentPeriodStart,
    periods: p.rentPeriods,
    countsAsRent: p.countsAsRent,
  });

  it.each([
    ["paid", [payment({ date: "2026-10-03" })]],
    ["partial", [payment({ date: "2026-10-03", amount: 4000 })]],
    ["check", [payment({ method: "check", paymentStatus: "pending", date: "2026-10-01" })]],
    ["late", []],
  ])("%s", (state, payments) => {
    expect(rentThisPeriod(lease, payments.map(rent), "2026-10-20")).toMatchObject({ state, periodLabel: "אוקטובר" });
  });

  it("on the day it's due: not yet, rather than late", () => {
    expect(rentThisPeriod({ ...lease, rentDayOfMonth: 20 }, [], "2026-10-20").state).toBe("upcoming");
  });

  it("no active lease: nothing is owed", () => {
    expect(rentThisPeriod(null, [], "2026-10-20").state).toBe("none");
  });

  it("a two-month payment covers both months, by the months it says", () => {
    const both = payment({ amount: 17000, date: "2026-09-01", rentPeriodStart: "2026-09-01", rentPeriods: 2 });
    expect(rentThisPeriod(lease, [both].map(rent), "2026-10-20")).toMatchObject({ state: "paid", collected: 8500 });
  });

  it("a refund isn't rent, and neither is another lease's payment", () => {
    const refund = payment({ amount: 300000, date: "2026-10-06", countsAsRent: false });
    const storage = payment({ amount: 8500, date: "2026-10-02", leaseId: "storage-lease" });
    expect(rentThisPeriod(lease, [refund, storage].map(rent), "2026-10-20").state).toBe("late");
  });

  it("a Hebrew lease: this period is the Hebrew month (חשון from 12 Oct 2026)", () => {
    const hebrew = { ...lease, rentCalendar: "hebrew" as const, rentHebrewDay: 1, startDate: "2026-07-15" };
    const paid = payment({ method: "check", date: "2026-10-12", amount: 8500 });
    expect(rentThisPeriod(hebrew, [paid].map(rent), "2026-10-20")).toMatchObject({ state: "paid", periodLabel: "חשון" });
    // Before 12 Oct it's still תשרי's, which that check doesn't pay.
    expect(rentThisPeriod(hebrew, [paid].map(rent), "2026-10-05")).toMatchObject({ state: "late", periodLabel: "תשרי" });
  });
});

describe("the expenses donut", () => {
  it("the five biggest, then אחר for the rest, in fixed colours", () => {
    const slices = donutSlices(
      ["א", "ב", "ג", "ד", "ה", "ו", "ז"].map((label, i) => ({ label, value: 700 - i * 100 }))
    );
    expect(slices.map((s) => s.label)).toEqual(["א", "ב", "ג", "ד", "ה", "אחר"]);
    expect(slices[0].color).toBe("#2a78d6");
    expect(slices[5]).toMatchObject({ value: 300, color: "#a8a7a0" });
  });

  it("five or fewer: no אחר, and nothing at zero", () => {
    expect(donutSlices([{ label: "משכנתא", value: 100 }, { label: "ריהוט", value: 0 }]).map((s) => s.label)).toEqual(["משכנתא"]);
    expect(donutSlices([])).toEqual([]);
  });
});

describe("money in US$ or C$ (2026-10-23)", () => {
  it("a row keeps its shekels as its amount, and its dollars beside them", () => {
    const usd = { currency: "USD" as const, amount: 1000, rate: 3.107, rateManual: false };
    const cad = { currency: "CAD" as const, amount: 500, rate: 2.2137, rateManual: false };
    const { done } = buildPropertyMovements(
      input({
        payments: [payment({ amount: 3107, foreign: usd })],
        expenses: [expense({ amount: 1106.85, foreign: cad }), expense({ id: "e2" })],
      })
    );
    expect(done.find((m) => m.key === "payment:p1")).toMatchObject({ amount: 3107, foreign: usd });
    expect(done.find((m) => m.key === "expense:e1")).toMatchObject({ amount: 1106.85, foreign: cad });
    expect(done.find((m) => m.key === "expense:e2")?.foreign).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import { cashNeeds, itemCertainty, openTotals } from "@/app/(app)/financial/payments-calendar/calendar.helpers";
import type { PaymentCalendarItem } from "@/lib/payables";

// Can this money be planned on, or is it only owed?
//
// A check with a deposit date is an instrument sitting in a drawer. A customer
// balance falling due on the same day is a hope. Both belong on the calendar —
// you want to chase the second — but only the first may be added into "what
// will I have", which is the whole point of the split.

function item(over: Partial<PaymentCalendarItem> & { id: string }): PaymentCalendarItem {
  return {
    direction: "in", date: "2026-09-20", amount: 1000, label: "x", sourceLabel: "", sourceHref: null,
    stage: "pending", paymentStatus: null, origin: "payment", sourceId: null, domainName: "",
    expenseId: null, category: null, businessDomain: null, accountId: null, paidAmount: null,
    descriptionRaw: null, notes: null, paymentMethod: null, dueDate: "2026-09-20", paidDate: null,
    overdue: false, installmentGroupId: null, installmentIndex: null, installmentCount: null,
    expenseProjectId: null, expenseOrderId: null, expensePropertyId: null, workerUserId: null,
    recurringTemplateId: null, recurrenceKey: null, variableAmount: false, autoPaid: false,
    ...over,
  };
}

describe("itemCertainty", () => {
  it("a real payment row is committed — somebody handed over a check or agreed a transfer", () => {
    expect(itemCertainty(item({ id: "payment:p1", paymentId: "p1", paymentMethod: "check" }))).toBe("committed");
  });

  it("a card settlement is committed — the customer already paid, the clearer owes us", () => {
    expect(itemCertainty(item({ id: "grow_batch:acc-1:2026-10-10" }))).toBe("committed");
  });

  it("a customer balance is only owed, however firm its due date looks", () => {
    expect(itemCertainty(item({ id: "order-receivable:o1", origin: "order_receivable" }))).toBe("owed");
    expect(itemCertainty(item({ id: "project-receivable:p1", origin: "project_receivable" }))).toBe("owed");
  });

  it("a promise and a projected rent month are owed too", () => {
    expect(itemCertainty(item({ id: "promise:x" }))).toBe("owed");
    expect(itemCertainty(item({ id: "rent_proj:L1:2026-10" }))).toBe("owed");
  });

  it("every outgoing row counts — a bill has to be paid whether or not it exists yet", () => {
    expect(itemCertainty(item({ id: "recur_proj:t:2026-10", direction: "out" }))).toBe("committed");
  });
});

describe("openTotals", () => {
  const day = [
    item({ id: "payment:check", paymentId: "check", amount: 4000 }),
    item({ id: "order-receivable:o1", origin: "order_receivable", amount: 9000 }),
    item({ id: "expense:e1", direction: "out", amount: 5000 }),
    item({ id: "payment:done", paymentId: "done", amount: 700, stage: "posted" }),
  ];

  it("nets only what is committed, and reports the debt it left out", () => {
    const t = openTotals(day);
    expect(t.inCommitted).toBe(4000);
    expect(t.inOwed).toBe(9000);
    expect(t.in).toBe(13000);
    expect(t.out).toBe(5000);
    // NOT 13,000 - 5,000: the ₪9,000 balance is not money you can plan around.
    expect(t.net).toBe(-1000);
  });

  it("ignores what has already happened", () => {
    expect(openTotals([item({ id: "payment:done", paymentId: "d", stage: "posted" })])).toMatchObject({
      in: 0, inCommitted: 0, inOwed: 0, out: 0, net: 0,
    });
  });
});

describe("cashNeeds", () => {
  const rows = [
    item({ id: "expense:a", direction: "out", date: "2026-09-18", amount: 5000 }),
    item({ id: "payment:b", paymentId: "b", date: "2026-09-19", amount: 3000 }),
    item({ id: "order-receivable:c", origin: "order_receivable", date: "2026-09-19", amount: 8000 }),
  ];
  const range = { from: "2026-09-16", to: "2026-09-30", recurringOnly: false, accountFilter: "" };

  it("answers with the shortfall against money that will actually arrive", () => {
    const r = cashNeeds(rows, range);
    expect(r.total).toBe(5000);
    expect(r.incoming).toBe(3000);
    expect(r.owed).toBe(8000);
    expect(r.net).toBe(-2000);
    // All three are still listed — the debt is shown, just not counted.
    expect(r.rows).toHaveLength(3);
  });
});

describe("cashNeeds — both reads of the same range", () => {
  // The user's rule: show the uncertain money, just don't trust it. So it is
  // listed, it has its own total, and it drives an "if everything lands"
  // figure — but it never moves the number you plan on.
  const rows = [
    item({ id: "expense:a", direction: "out", date: "2026-09-18", amount: 5000 }),
    item({ id: "payment:check", paymentId: "check", date: "2026-09-19", amount: 3000 }),
    item({ id: "rent_proj:L1:2026-09", date: "2026-09-20", amount: 4000 }),
    item({ id: "order-receivable:o1", origin: "order_receivable", date: "2026-09-22", amount: 8000 }),
  ];
  const range = { from: "2026-09-16", to: "2026-09-30", recurringOnly: false, accountFilter: "" };

  it("plans on the certain money and reports the rest beside it", () => {
    const r = cashNeeds(rows, range);
    expect(r.incoming).toBe(3000); // the check
    expect(r.owed).toBe(12000); // projected rent + the balance
    expect(r.net).toBe(-2000); // 3,000 in against 5,000 out
    expect(r.netIfAll).toBe(10000); // 15,000 against 5,000, if it all lands
  });

  it("lists every row either way — nothing is hidden, only uncounted", () => {
    expect(cashNeeds(rows, range).rows).toHaveLength(4);
  });

  it("with nothing uncertain the two reads agree", () => {
    const r = cashNeeds(rows.filter((i) => i.id.startsWith("expense:") || i.id.startsWith("payment:")), range);
    expect(r.owed).toBe(0);
    expect(r.net).toBe(r.netIfAll);
  });
});

describe("openTotals — settled money is kept, not dropped", () => {
  // With "הצג ששולמו" on, paid rows are on screen. A headline that ignored
  // them did not add up to the list underneath it, which read as a bug.
  const day = [
    item({ id: "payment:open", paymentId: "open", amount: 4000 }),
    item({ id: "payment:collected", paymentId: "collected", amount: 9000, stage: "posted" }),
    item({ id: "expense:paid", direction: "out", amount: 700, stage: "posted" }),
    item({ id: "expense:due", direction: "out", amount: 500 }),
  ];

  it("reports what already moved separately from what is still open", () => {
    const t = openTotals(day);
    expect(t.in).toBe(4000);
    expect(t.settledIn).toBe(9000);
    expect(t.out).toBe(500);
    expect(t.settledOut).toBe(700);
    // The net stays about what is still to come.
    expect(t.net).toBe(3500);
  });

  it("lets a caller add up everything on the day", () => {
    const t = openTotals(day);
    expect(t.in + t.settledIn).toBe(13000);
    expect(t.out + t.settledOut).toBe(1200);
  });
});

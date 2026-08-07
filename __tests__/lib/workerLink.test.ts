import { describe, expect, it } from "vitest";
import { isMissingLinkColumn, matchWorkerByPhone, type WorkerOption } from "@/lib/customers/workerLink";
import {
  buildCounterpartyBalance,
  hasAnyPosition,
} from "@/lib/customers/counterpartyBalance";

function worker(overrides: Partial<WorkerOption> & { id: string }): WorkerOption {
  return {
    label: "עובד",
    phone: null,
    linkedCustomerId: null,
    linkedCustomerName: null,
    ...overrides,
  };
}

describe("matchWorkerByPhone", () => {
  const staff = [
    worker({ id: "u1", label: "יוסי", phone: "052-1234567" }),
    worker({ id: "u2", label: "משה", phone: "+972541112222" }),
    worker({
      id: "u3",
      label: "דוד",
      phone: "0501234567",
      linkedCustomerId: "c9",
      linkedCustomerName: "דוד",
    }),
  ];

  it("matches regardless of separators", () => {
    expect(matchWorkerByPhone(staff, "0521234567")?.id).toBe("u1");
    expect(matchWorkerByPhone(staff, "052 123 4567")?.id).toBe("u1");
  });

  it("folds the +972 prefix so both spellings of one number match", () => {
    expect(matchWorkerByPhone(staff, "0541112222")?.id).toBe("u2");
    expect(matchWorkerByPhone(staff, "+972-54-111-2222")?.id).toBe("u2");
  });

  it("checks every phone-ish field it is given", () => {
    expect(matchWorkerByPhone(staff, "", "0541112222")?.id).toBe("u2");
  });

  it("skips workers who already have a customer row", () => {
    // Suggesting u3 would push toward a duplicate the unique index rejects.
    expect(matchWorkerByPhone(staff, "0501234567")).toBeNull();
  });

  it("ignores fragments too short to identify anyone", () => {
    expect(matchWorkerByPhone(staff, "052")).toBeNull();
    expect(matchWorkerByPhone(staff, "")).toBeNull();
    expect(matchWorkerByPhone(staff, null, undefined)).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(matchWorkerByPhone(staff, "0539998888")).toBeNull();
  });
});

describe("buildCounterpartyBalance", () => {
  // The case this was built for: monthly-paid worker, business borrowed ₪15,000
  // from him, he owes ₪4,200 on orders, ₪6,500 of salary is open.
  const workerWhoLentUsMoney = buildCounterpartyBalance({
    salesOwedToUs: 4200,
    loansOwedToUs: 0,
    loansOwedByUs: 15000,
    payrollOwed: 6500,
  });

  it("nets loans against sales", () => {
    expect(workerWhoLentUsMoney.totalOwedToUs).toBe(4200);
    expect(workerWhoLentUsMoney.totalOwedByUs).toBe(15000);
    expect(workerWhoLentUsMoney.net).toBe(-10800);
  });

  it("keeps salary out of the net", () => {
    // The whole point: the net must not move when payroll does.
    expect(workerWhoLentUsMoney.payrollOwed).toBe(6500);
    expect(
      buildCounterpartyBalance({
        salesOwedToUs: 4200,
        loansOwedToUs: 0,
        loansOwedByUs: 15000,
        payrollOwed: 0,
      }).net
    ).toBe(workerWhoLentUsMoney.net);
  });

  it("counts a loan we gave as money owed to us, alongside unpaid orders", () => {
    const balance = buildCounterpartyBalance({
      salesOwedToUs: 1000,
      loansOwedToUs: 2500,
      loansOwedByUs: 0,
      payrollOwed: null,
    });
    expect(balance.totalOwedToUs).toBe(3500);
    expect(balance.net).toBe(3500);
    expect(balance.payrollOwed).toBeNull();
  });

  it("floors every side at zero — an overpaid order is not a loan repayment", () => {
    const balance = buildCounterpartyBalance({
      salesOwedToUs: -500,
      loansOwedToUs: 0,
      loansOwedByUs: 300,
      payrollOwed: -50,
    });
    expect(balance.salesOwedToUs).toBe(0);
    expect(balance.net).toBe(-300);
    expect(balance.payrollOwed).toBe(0);
  });

  it("distinguishes a plain customer from a worker with nothing owed", () => {
    const plain = buildCounterpartyBalance({
      salesOwedToUs: 0,
      loansOwedToUs: 0,
      loansOwedByUs: 0,
      payrollOwed: null,
    });
    expect(plain.payrollOwed).toBeNull();
    expect(hasAnyPosition(plain)).toBe(false);
  });
});

describe("hasAnyPosition", () => {
  const empty = { salesOwedToUs: 0, loansOwedToUs: 0, loansOwedByUs: 0, payrollOwed: null };

  it("is true when only a loan we took exists", () => {
    expect(hasAnyPosition(buildCounterpartyBalance({ ...empty, loansOwedByUs: 15000 }))).toBe(true);
  });

  it("is true when only salary is open", () => {
    expect(hasAnyPosition(buildCounterpartyBalance({ ...empty, payrollOwed: 6500 }))).toBe(true);
  });

  it("ignores rounding dust", () => {
    expect(hasAnyPosition(buildCounterpartyBalance({ ...empty, salesOwedToUs: 0.001 }))).toBe(false);
  });
});

describe("isMissingLinkColumn", () => {
  it("recognises the pre-migration undefined-column error", () => {
    expect(isMissingLinkColumn({ code: "42703", message: "column does not exist" })).toBe(true);
    expect(isMissingLinkColumn({ message: 'column customers.linked_user_id does not exist' })).toBe(true);
  });

  it("does not swallow unrelated failures", () => {
    expect(isMissingLinkColumn(null)).toBe(false);
    expect(isMissingLinkColumn(undefined)).toBe(false);
    expect(isMissingLinkColumn({ code: "23505", message: "duplicate key value" })).toBe(false);
  });
});

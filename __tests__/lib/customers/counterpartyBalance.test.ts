import { describe, it, expect } from "vitest";
import { buildCounterpartyBalance, hasAnyPosition } from "@/lib/customers/counterpartyBalance";

describe("buildCounterpartyBalance", () => {
  it("nets sales + loans owed to us against loans owed by us", () => {
    const balance = buildCounterpartyBalance({
      salesOwedToUs: 1000,
      loansOwedToUs: 500,
      loansOwedByUs: 200,
      payrollOwed: null,
    });
    expect(balance.totalOwedToUs).toBe(1500);
    expect(balance.totalOwedByUs).toBe(200);
    expect(balance.net).toBe(1300); // positive = they owe us on balance
  });

  it("net goes negative when we owe them more than they owe us", () => {
    const balance = buildCounterpartyBalance({
      salesOwedToUs: 0,
      loansOwedToUs: 0,
      loansOwedByUs: 5000,
      payrollOwed: null,
    });
    expect(balance.net).toBe(-5000);
  });

  it("payroll is reported alongside net but never folded into it", () => {
    const balance = buildCounterpartyBalance({
      salesOwedToUs: 1000,
      loansOwedToUs: 0,
      loansOwedByUs: 0,
      payrollOwed: 3000,
    });
    expect(balance.payrollOwed).toBe(3000);
    expect(balance.net).toBe(1000); // unaffected by payroll
    expect(balance.totalOwedByUs).toBe(0); // payroll isn't in here either
  });

  it("null payroll stays null (not a worker), not coerced to 0", () => {
    const balance = buildCounterpartyBalance({
      salesOwedToUs: 0,
      loansOwedToUs: 0,
      loansOwedByUs: 0,
      payrollOwed: null,
    });
    expect(balance.payrollOwed).toBeNull();
  });

  it("floors every input at 0 — a negative figure never flips the direction of what's owed", () => {
    const balance = buildCounterpartyBalance({
      salesOwedToUs: -100,
      loansOwedToUs: -50,
      loansOwedByUs: -20,
      payrollOwed: -10,
    });
    expect(balance.salesOwedToUs).toBe(0);
    expect(balance.loansOwedToUs).toBe(0);
    expect(balance.loansOwedByUs).toBe(0);
    expect(balance.payrollOwed).toBe(0);
    expect(balance.net).toBe(0);
  });
});

describe("hasAnyPosition", () => {
  it("false when every figure is (near) zero", () => {
    expect(
      hasAnyPosition(
        buildCounterpartyBalance({ salesOwedToUs: 0, loansOwedToUs: 0, loansOwedByUs: 0, payrollOwed: null })
      )
    ).toBe(false);
  });
  it("true when there's a sales/loan balance", () => {
    expect(
      hasAnyPosition(
        buildCounterpartyBalance({ salesOwedToUs: 100, loansOwedToUs: 0, loansOwedByUs: 0, payrollOwed: null })
      )
    ).toBe(true);
  });
  it("true when there's only an outstanding payroll amount, even with net = 0", () => {
    const balance = buildCounterpartyBalance({
      salesOwedToUs: 0,
      loansOwedToUs: 0,
      loansOwedByUs: 0,
      payrollOwed: 500,
    });
    expect(balance.net).toBe(0);
    expect(hasAnyPosition(balance)).toBe(true);
  });
  it("a sub-cent rounding remainder doesn't count as a real position", () => {
    expect(
      hasAnyPosition(
        buildCounterpartyBalance({ salesOwedToUs: 0.001, loansOwedToUs: 0, loansOwedByUs: 0, payrollOwed: null })
      )
    ).toBe(false);
  });
});

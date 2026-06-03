import { describe, it, expect } from "vitest";
import {
  norm,
  parseAmount,
  parseDateToIso,
  shiftIso,
  findDuplicate,
  parseStatementLines,
  type ExistingExpense,
} from "@/lib/financial/cardImport";

describe("parseAmount", () => {
  it("passes through numbers and parses strings", () => {
    expect(parseAmount(42)).toBe(42);
    expect(parseAmount("100")).toBe(100);
    expect(parseAmount("1,234.50")).toBe(1234.5);
    expect(parseAmount("₪ 99.90")).toBe(99.9);
  });

  it("handles negatives (minus and parentheses)", () => {
    expect(parseAmount("-50")).toBe(-50);
    expect(parseAmount("(50)")).toBe(-50);
  });

  it("returns NaN for empty/invalid", () => {
    expect(Number.isNaN(parseAmount(""))).toBe(true);
    expect(Number.isNaN(parseAmount("abc"))).toBe(true);
  });
});

describe("parseDateToIso", () => {
  it("parses dd/mm/yyyy and dd/mm/yy", () => {
    expect(parseDateToIso("01/06/2026")).toBe("2026-06-01");
    expect(parseDateToIso("1.6.26")).toBe("2026-06-01");
    expect(parseDateToIso("31-12-99")).toBe("1999-12-31");
  });

  it("passes through ISO", () => {
    expect(parseDateToIso("2026-06-01")).toBe("2026-06-01");
  });

  it("rejects out-of-range and empty", () => {
    expect(parseDateToIso("32/01/2026")).toBeNull();
    expect(parseDateToIso("")).toBeNull();
  });
});

describe("shiftIso", () => {
  it("shifts by whole days across month boundaries", () => {
    expect(shiftIso("2026-06-01", -3)).toBe("2026-05-29");
    expect(shiftIso("2026-06-30", 2)).toBe("2026-07-02");
  });
});

describe("norm", () => {
  it("strips quotes and collapses whitespace", () => {
    expect(norm('  שופ   רסל"  ')).toBe("שופ רסל");
  });
});

describe("findDuplicate", () => {
  const existing = (e: Partial<ExistingExpense>): ExistingExpense => ({
    expense_date: "",
    transaction_date: null,
    amount: 0,
    description: "",
    ...e,
  });

  it("matches a re-import: existing stored under the billing date, new row keyed by txn date", () => {
    // Purchase on June 1, billed July 10. A prior import saved expense_date = billing date.
    const prior = existing({ expense_date: "2026-07-10", transaction_date: "2026-06-01", amount: 250, description: "סופר" });
    const dup = findDuplicate(
      { amount: 250, billingDate: "2026-07-10", txnDate: "2026-06-01", description: "סופר" },
      [prior],
      3
    );
    expect(dup).toBe(prior);
  });

  it("matches when only billing dates align (older rows have no transaction_date)", () => {
    // The exact bug scenario: existing row has only expense_date = billing date.
    const prior = existing({ expense_date: "2026-07-10", transaction_date: null, amount: 250, description: "סופר" });
    const dup = findDuplicate(
      { amount: 250, billingDate: "2026-07-10", txnDate: "2026-06-01", description: "סופר" },
      [prior],
      3
    );
    expect(dup).toBe(prior);
  });

  it("matches a manual entry saved under the real transaction date", () => {
    const manual = existing({ expense_date: "2026-06-02", transaction_date: null, amount: 80, description: "דלק" });
    const dup = findDuplicate(
      { amount: 80, billingDate: "2026-07-10", txnDate: "2026-06-01", description: "דלק פז" },
      [manual],
      3
    );
    expect(dup).toBe(manual);
  });

  it("does not match when the amount differs", () => {
    const prior = existing({ expense_date: "2026-06-01", transaction_date: "2026-06-01", amount: 250, description: "סופר" });
    const dup = findDuplicate(
      { amount: 251, billingDate: "2026-06-01", txnDate: "2026-06-01", description: "סופר" },
      [prior],
      3
    );
    expect(dup).toBeNull();
  });

  it("does not match when every date pair is outside the window", () => {
    const prior = existing({ expense_date: "2026-05-01", transaction_date: "2026-05-01", amount: 250, description: "סופר" });
    const dup = findDuplicate(
      { amount: 250, billingDate: "2026-07-10", txnDate: "2026-06-01", description: "סופר" },
      [prior],
      3
    );
    expect(dup).toBeNull();
  });

  it("prefers the candidate whose merchant name overlaps", () => {
    const wrongName = existing({ expense_date: "2026-06-01", transaction_date: "2026-06-01", amount: 250, description: "חניון" });
    const rightName = existing({ expense_date: "2026-06-02", transaction_date: "2026-06-02", amount: 250, description: "סופר שלי" });
    const dup = findDuplicate(
      { amount: 250, billingDate: "2026-06-01", txnDate: "2026-06-01", description: "סופר" },
      [wrongName, rightName],
      3
    );
    expect(dup).toBe(rightName);
  });

  it("returns null when the row has no usable date", () => {
    const prior = existing({ expense_date: "2026-06-01", transaction_date: "2026-06-01", amount: 250, description: "סופר" });
    const dup = findDuplicate({ amount: 250, billingDate: "", txnDate: "", description: "סופר" }, [prior], 3);
    expect(dup).toBeNull();
  });
});

describe("parseStatementLines", () => {
  it("extracts a transaction with two dates (txn + billing) and an amount", () => {
    const { txns, confidence } = parseStatementLines(["01/06/2026 10/07/2026 שופרסל דיל 250.90"]);
    expect(confidence).toBe(1);
    expect(txns[0].txnDate).toBe("2026-06-01");
    expect(txns[0].billingDate).toBe("2026-07-10");
    expect(txns[0].amount).toBe(250.9);
    expect(txns[0].merchant).toContain("שופרסל");
  });

  it("treats one date as the transaction date and leaves billing empty", () => {
    const { txns } = parseStatementLines(["15/06/26 דלק פז 312.00"]);
    expect(txns[0].txnDate).toBe("2026-06-15");
    expect(txns[0].billingDate).toBe("");
  });

  it("captures installments and marks refunds negative", () => {
    const { txns } = parseStatementLines([
      "03/06/2026 ריהוט תשלום 2 מתוך 6 199.90",
      "04/06/2026 זיכוי החזר מוצר 50.00",
    ]);
    expect(txns[0].installment).toBe("2/6");
    expect(txns[1].amount).toBe(-50);
  });

  it("skips lines without a decimal amount (totals, card digits)", () => {
    const { txns, confidence } = parseStatementLines([
      "חשבון כרטיס: 176606 ספרות אחרונות 9557",
      "סה״כ לחיוב",
    ]);
    expect(confidence).toBe(0);
    expect(txns).toEqual([]);
  });
});

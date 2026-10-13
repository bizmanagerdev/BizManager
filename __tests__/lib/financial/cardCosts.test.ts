import { describe, it, expect } from "vitest";
import { buildCardMonths, type CardLine } from "@/lib/financial/cardCosts";

const line = (over: Partial<CardLine> & Pick<CardLine, "statementId" | "cardLabel" | "amount">): CardLine => ({
  include: true,
  expenseDate: "2026-10-02",
  transactionDate: "2026-09-10",
  businessDomain: "home",
  ...over,
});

describe("buildCardMonths", () => {
  it("puts a statement in its own month (the purchases' month), not the month the bank takes it", () => {
    // הלר בית 9.26: bought in September, charged on 2/10.
    const { months } = buildCardMonths(
      [
        line({ statementId: "s9", cardLabel: "ויזה 9557", amount: 100, transactionDate: "2026-09-03" }),
        line({ statementId: "s9", cardLabel: "ויזה 9557", amount: 250.5, transactionDate: "2026-09-28" }),
        // An installment bought months earlier doesn't move the statement.
        line({ statementId: "s9", cardLabel: "ויזה 9557", amount: 90, transactionDate: "2026-05-14" }),
      ],
      [],
      { s9: "הלר בית 9.26" }
    );
    expect(months.map((m) => m.month)).toEqual(["2026-09"]);
    const [cell] = months[0].cells["ויזה 9557"];
    expect(cell).toMatchObject({ amount: 440.5, charged: false, bankDate: "2026-10-02", statementName: "הלר בית 9.26" });
  });

  it("shows the whole statement as the recorded bank charge, never spread over purchase dates", () => {
    const { months } = buildCardMonths(
      [
        line({ statementId: "s8", cardLabel: "ויזה 9557", amount: 20000, expenseDate: "2026-09-02", transactionDate: "2026-08-10" }),
        line({ statementId: "s8", cardLabel: "ויזה 9557", amount: 196.58, expenseDate: "2026-09-02", transactionDate: "2026-07-30" }),
      ],
      [{ statementId: "s8", cardLabel: "ויזה 9557", amount: 20323.82, chargeDate: "2026-09-02" }],
      {}
    );
    expect(months).toHaveLength(1);
    expect(months[0].month).toBe("2026-08");
    expect(months[0].cells["ויזה 9557"][0]).toMatchObject({ amount: 20323.82, charged: true, bankDate: "2026-09-02" });
    expect(months[0].total).toBe(20323.82);
  });

  it("decides the month per statement file: a card with a few next-month lines stays with its statement", () => {
    // הלר עסקי 8.26: 7372's lines were bought in August; two of Diners' three on 1/9.
    const { months } = buildCardMonths(
      [
        line({ statementId: "b8", cardLabel: "ויזה 7372", amount: 100, expenseDate: "2026-09-02", transactionDate: "2026-08-04" }),
        line({ statementId: "b8", cardLabel: "ויזה 7372", amount: 100, expenseDate: "2026-09-02", transactionDate: "2026-08-15" }),
        line({ statementId: "b8", cardLabel: "ויזה 7372", amount: 100, expenseDate: "2026-09-02", transactionDate: "2026-08-20" }),
        line({ statementId: "b8", cardLabel: "דיינרס 7896", amount: 50, expenseDate: "2026-09-02", transactionDate: "2026-08-30" }),
        line({ statementId: "b8", cardLabel: "דיינרס 7896", amount: 60, expenseDate: "2026-09-02", transactionDate: "2026-09-01" }),
        line({ statementId: "b8", cardLabel: "דיינרס 7896", amount: 70, expenseDate: "2026-09-02", transactionDate: "2026-09-01" }),
      ],
      [],
      {}
    );
    expect(months.map((m) => m.month)).toEqual(["2026-08"]);
    expect(Object.keys(months[0].cells).sort()).toEqual(["דיינרס 7896", "ויזה 7372"]);
  });

  it("a card charged late in the same month (Mercantile, the 27th) stays in that month", () => {
    const { months } = buildCardMonths(
      [line({ statementId: "m8", cardLabel: "מאסטרכארד 7793", amount: 3104.9, expenseDate: "2026-08-27", transactionDate: "2026-08-12" })],
      [{ statementId: "m8", cardLabel: "מאסטרכארד 7793", amount: 3104.9, chargeDate: "2026-08-27" }],
      {}
    );
    expect(months[0].month).toBe("2026-08");
  });

  it("breaks a statement down by domain, refunds netted; left-out lines apart", () => {
    const { months } = buildCardMonths(
      [
        line({ statementId: "s", cardLabel: "ויזה 9828", amount: 1824.74, businessDomain: "home" }),
        line({ statementId: "s", cardLabel: "ויזה 9828", amount: -257.66, businessDomain: "home" }),
        line({ statementId: "s", cardLabel: "ויזה 9828", amount: 300, businessDomain: "general_business" }),
        line({ statementId: "s", cardLabel: "ויזה 9828", amount: 1180, include: false, businessDomain: "" }),
      ],
      [],
      {}
    );
    const [cell] = months[0].cells["ויזה 9828"];
    expect(cell.amount).toBe(3047.08);
    expect(cell.purchases).toBe(3304.74);
    expect(cell.refunds).toBe(257.66);
    expect(cell.leftOut).toBe(1180);
    expect(cell.byDomain).toEqual([
      { domain: "home", amount: 1567.08 },
      { domain: "general_business", amount: 300 },
    ]);
  });

  it("orders cards by total and months newest first; two statements of one card in a month both count", () => {
    const { cards, months } = buildCardMonths(
      [
        line({ statementId: "a", cardLabel: "קטן 1111", amount: 10, transactionDate: "2026-07-05" }),
        line({ statementId: "b", cardLabel: "גדול 2222", amount: 500, transactionDate: "2026-07-05" }),
        line({ statementId: "c", cardLabel: "גדול 2222", amount: 25, transactionDate: "2026-07-20" }),
        line({ statementId: "d", cardLabel: "קטן 1111", amount: 40, transactionDate: "2026-08-05" }),
      ],
      [],
      {}
    );
    expect(cards).toEqual(["גדול 2222", "קטן 1111"]);
    expect(months.map((m) => m.month)).toEqual(["2026-08", "2026-07"]);
    expect(months[1].cells["גדול 2222"]).toHaveLength(2);
    expect(months[1].total).toBe(535);
  });
});

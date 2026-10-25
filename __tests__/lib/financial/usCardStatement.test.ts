import { describe, expect, it } from "vitest";
import {
  checkUsStatement,
  parseUsAmount,
  parseUsCardCsv,
  parseUsCardStatementLines,
} from "@/lib/financial/usCardStatement";

// Shaped like the text lines lib/financial/pdfStatement.ts gets from the
// owner's real statements (2026-10-25); names and merchants are made up.
const CAPITAL_ONE = [
  "Page 1 of 4",
  "Venture X Card | Visa Infinite ending in 1111",
  "Jul 25, 2026 - Aug 24, 2026 | 31 days in Billing Cycle",
  "For online and phone payments, the Previous Balance $4,608.84",
  "on the statement closing date when Payments - $3,146.00",
  "Other Credits - $4.50",
  "Transactions + $2,062.93",
  "Cash Advances + $0.00",
  "Fees Charged + $395.00",
  "Interest Charged + $0.00",
  "New Balance = $3,916.27",
  "Payment Due Date: Sep 18, 2026 Account ending in 1111",
  "Page 2 of 4",
  "Transactions",
  "DANA LEVI #1111: Payments, Credits and Adjustments",
  "Trans Date Post Date Description Amount",
  "Aug 17 Aug 17 CAPITAL ONE MOBILE PYMT - $3,100.00",
  "Aug 17 Aug 17 CAPITAL ONE MOBILE PYMT - $46.00",
  "Jul 30 Aug 1 SOME AIRLINE 123 - $4.50",
  "DANA LEVI #1111: Transactions",
  "Trans Date Post Date Description Amount",
  "Jul 24 Jul 25 SOME AIRLINE 456 $1,705.00",
  "TK#: 456 PSGR: SOMEONE",
  "Aug 15 Aug 17 PHONE SHOP BET SHEMESH $23.43",
  "$70.00",
  "ILS",
  "2.98 Exchange Rate",
  "DANA LEVI #1111: Total Transactions $1,728.43",
  "SAM COHEN #2222: Payments, Credits and Adjustments",
  "Trans Date Post Date Description Amount",
  "SAM COHEN #2222: Transactions",
  "Trans Date Post Date Description Amount",
  "Additional Information on the next page",
  "Page 3 of 4",
  "Venture X Card | Visa Infinite ending in 1111",
  "Jul 25, 2026 - Aug 24, 2026 | 31 days in Billing Cycle",
  "Transactions (Continued)",
  "Trans Date Post Date Description Amount",
  "Aug 21 Aug 22 COFFEE PLACE $334.50",
  "SAM COHEN #2222: Total Transactions $334.50",
  "Total Transactions for This Period $2,062.93",
  "Fees",
  "Trans Date Post Date Description Amount",
  "Jul 26 Jul 26 CAPITAL ONE MEMBER FEE $395.00",
  "Total Fees for This Period $395.00",
  "Interest Charged",
  "Interest Charge on Purchases $0.00",
  "Total Interest for This Period $0.00",
  "Totals Year-to-Date",
];

const CHASE = [
  "ACCOUNT ACCOUNT SUMMARY SUMMARY",
  "Account Number: XXXX XXXX XXXX 3333",
  "Previous Balance $1,000.00",
  "Payment, Credits -$1,050.00",
  "Purchases +$1,116.00",
  "Cash Advances +$602.95",
  "Balance Transfers $0.00",
  "Fees Charged +$30.15",
  "Interest Charged +$304.75",
  "New Balance $2,003.85",
  "Opening/Closing Date 12/15/26 - 01/14/27",
  "Payment Due Date: 02/11/27",
  "ACCOUNT ACCOUNT ACTIVITY ACTIVITY",
  "Date of",
  "Transaction",
  "Merchant Name or Transaction Description $ Amount",
  "PAYMENTS AND OTHER CREDITS",
  "12/16 Payment Thank You-Mobile -1,000.00",
  "01/04 SOME AIRLINE 97239771111 -50.00",
  "PURCHASE",
  "12/19 HOSTING INC. CA 1,115.33",
  "01/02 SHOP JERUSALEM .67",
  "01/04 SHEQEL",
  "YAACOV Page 2 of 3 Statement Date: 01/14/27",
  "ACCOUNT ACTIVITY (CONTINUED)",
  "2.00 X 0.335000000 (EXCHG RATE)",
  "CASH ADVANCES",
  "12/31 BANK ATM nabag 602.95",
  "FEES CHARGED",
  "12/31 TRANSACTION FEE 30.15",
  "TOTAL FEES FOR THIS PERIOD $30.15",
  "INTEREST CHARGED",
  "01/14 PURCHASE INTEREST CHARGE 304.73",
  "01/14 CASH ADVANCE INTEREST CHARGE .02",
  "TOTAL INTEREST FOR THIS PERIOD $304.75",
  "2027 Totals Year-to-Date",
  "PURCHASES",
  "Purchases 25.74%(v)(d) - 0 - - 0 -",
];

describe("parseUsAmount", () => {
  it("reads the ways the statements print a dollar amount", () => {
    expect(parseUsAmount("$2,135.00")).toBe(2135);
    expect(parseUsAmount("- $4.50")).toBe(-4.5);
    expect(parseUsAmount("-4,616.87")).toBe(-4616.87);
    expect(parseUsAmount("+$15,666.89")).toBe(15666.89);
    expect(parseUsAmount(".67")).toBe(0.67);
    expect(parseUsAmount("TOTAL")).toBeNaN();
  });
});

describe("parseUsCardStatementLines — Capital One", () => {
  const s = parseUsCardStatementLines(CAPITAL_ONE)!;

  it("reads the card, the period, the due date and the balances", () => {
    expect(s.issuer).toBe("capital_one");
    expect(s.cardName).toBe("Venture X");
    expect(s.cardLast4).toBe("1111");
    expect([s.periodStart, s.periodEnd, s.dueDate]).toEqual(["2026-07-25", "2026-08-24", "2026-09-18"]);
    expect([s.previousBalance, s.newBalance]).toEqual([4608.84, 3916.27]);
  });

  it("tells payments from refunds, keeps the post date, and the second card's lines", () => {
    const kinds = s.lines.map((l) => [l.description, l.kind, l.amount, l.postDate, l.cardLast4]);
    expect(kinds).toEqual([
      ["CAPITAL ONE MOBILE PYMT", "payment", -3100, "2026-08-17", "1111"],
      ["CAPITAL ONE MOBILE PYMT", "payment", -46, "2026-08-17", "1111"],
      ["SOME AIRLINE 123", "charge", -4.5, "2026-08-01", "1111"],
      ["SOME AIRLINE 456", "charge", 1705, "2026-07-25", "1111"],
      ["PHONE SHOP BET SHEMESH", "charge", 23.43, "2026-08-17", "1111"],
      ["COFFEE PLACE", "charge", 334.5, "2026-08-22", "2222"],
      ["CAPITAL ONE MEMBER FEE", "charge", 395, "2026-07-26", "1111"],
    ]);
    expect(s.lines[5].cardholder).toBe("SAM COHEN");
    expect(s.lines[3].txnDate).toBe("2026-07-24");
    expect(s.lines[4].detail).toBe("$70.00 · ILS · 2.98 Exchange Rate");
    expect(s.lines[6].section).toBe("fees");
  });

  it("adds up to the statement", () => {
    const check = checkUsStatement(s);
    expect(check).toMatchObject({ available: true, ok: true, difference: 0 });
    expect(check.rows.map((r) => r.label)).toEqual(["תשלומים", "זיכויים", "קניות", "משיכות מזומן", "עמלות", "ריבית"]);
  });
});

describe("parseUsCardStatementLines — Chase", () => {
  const s = parseUsCardStatementLines(CHASE)!;

  it("reads the period across a new year, and lines into the right year", () => {
    expect(s.issuer).toBe("chase");
    expect(s.cardLast4).toBe("3333");
    expect([s.periodStart, s.periodEnd, s.dueDate]).toEqual(["2026-12-15", "2027-01-14", "2027-02-11"]);
    expect(s.lines.map((l) => l.postDate)).toEqual([
      "2026-12-16", "2027-01-04", "2026-12-19", "2027-01-02", "2026-12-31", "2026-12-31", "2027-01-14", "2027-01-14",
    ]);
  });

  it("knows payments, refunds, cash advances, fees and interest, and amounts with no leading 0", () => {
    expect(s.lines.map((l) => [l.kind, l.section, l.amount])).toEqual([
      ["payment", "payments_credits", -1000],
      ["charge", "payments_credits", -50],
      ["charge", "purchases", 1115.33],
      ["charge", "purchases", 0.67],
      ["cash_advance", "cash_advances", 602.95],
      ["charge", "fees", 30.15],
      ["charge", "interest", 304.73],
      ["charge", "interest", 0.02],
    ]);
    // Its foreign amount, read across the page break; the page footer isn't.
    expect(s.lines[3].detail).toBe("01/04 SHEQEL · 2.00 X 0.335000000 (EXCHG RATE)");
  });

  it("adds up to the statement", () => {
    expect(checkUsStatement(s)).toMatchObject({ available: true, ok: true, difference: 0 });
  });

  it("says what's missing when a line wasn't read", () => {
    const short = parseUsCardStatementLines(CHASE.filter((l) => !l.startsWith("01/02 SHOP")))!;
    const check = checkUsStatement(short);
    expect(check.ok).toBe(false);
    expect(check.difference).toBe(0.67);
    expect(check.rows.find((r) => r.label === "קניות")).toMatchObject({ printed: 1116, read: 1115.33, ok: false });
  });
});

describe("parseUsCardStatementLines — other files", () => {
  it("is null for an Israeli statement's lines", () => {
    expect(parseUsCardStatementLines(["שם כרטיס: ויזה כאל זהב 9557", "01/09/26 שופרסל 123.40"])).toBeNull();
    expect(parseUsCardStatementLines([])).toBeNull();
  });
});

describe("parseUsCardCsv", () => {
  it("reads Chase's download: a purchase is −, a payment +", () => {
    const s = parseUsCardCsv([
      ["Transaction Date", "Post Date", "Description", "Category", "Type", "Amount", "Memo"],
      ["09/24/2026", "09/25/2026", "HOSTING INC.", "Shopping", "Sale", "-21.68", ""],
      ["09/16/2026", "09/16/2026", "Payment Thank You-Mobile", "", "Payment", "146.00", ""],
      ["09/20/2026", "09/21/2026", "SOME AIRLINE", "Travel", "Return", "50.00", ""],
      ["10/14/2026", "10/14/2026", "PURCHASE INTEREST CHARGE", "Fees & Adjustments", "Fee", "-304.73", ""],
    ])!;
    expect(s).toMatchObject({ issuer: "chase", source: "csv", previousBalance: null, periodStart: "2026-09-16", periodEnd: "2026-10-14" });
    expect(s.lines.map((l) => [l.kind, l.section, l.amount, l.postDate, l.txnDate])).toEqual([
      ["charge", "purchases", 21.68, "2026-09-25", "2026-09-24"],
      ["payment", "payments_credits", -146, "2026-09-16", "2026-09-16"],
      ["charge", "payments_credits", -50, "2026-09-21", "2026-09-20"],
      ["charge", "interest", 304.73, "2026-10-14", "2026-10-14"],
    ]);
    expect(checkUsStatement(s).available).toBe(false);
  });

  it("reads Capital One's download: debit and credit columns, the card number", () => {
    const s = parseUsCardCsv([
      ["Transaction Date", "Posted Date", "Card No.", "Description", "Category", "Debit", "Credit"],
      ["2026-09-04", "2026-09-05", "1111", "WINE SHOP BROOKLYN NY", "Dining", "357.07", ""],
      ["2026-09-13", "2026-09-14", "1111", "CAPITAL ONE MOBILE PYMT", "Payment/Credit", "", "1000.00"],
      ["2026-09-08", "2026-09-09", "2222", "PHONE SHOP MONSEY NY", "Phone", "37.93", ""],
      ["2026-07-09", "2026-07-09", "1111", "CAPITAL ONE MEMBER FEE", "Fee/Interest Charge", "395.00", ""],
    ])!;
    expect(s.issuer).toBe("capital_one");
    expect(s.lines.map((l) => [l.kind, l.section, l.amount, l.cardLast4])).toEqual([
      ["charge", "purchases", 357.07, "1111"],
      ["payment", "payments_credits", -1000, "1111"],
      ["charge", "purchases", 37.93, "2222"],
      ["charge", "fees", 395, "1111"],
    ]);
  });

  it("is null for any other sheet", () => {
    expect(parseUsCardCsv([["תאריך", "בית עסק", "סכום"], ["01/09/2026", "שופרסל", "100"]])).toBeNull();
  });
});

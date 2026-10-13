import { describe, it, expect } from "vitest";
import {
  norm,
  parseAmount,
  parseDateToIso,
  shiftIso,
  findDuplicate,
  parseStatementLines,
  detectHeaderRow,
  extractCardName,
  findColumn,
  findBankDateColumn,
  findStatementTotal,
  nextChargeDate,
  isRealCardLabel,
  buildKnownCards,
  FIELD_TOKENS,
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

  it("does NOT match a later instalment of the same purchase (same purchase date and amount)", () => {
    // Real case: ₪270.33 bought 21/04 in instalments — billed in May, then again in
    // June and August. Every charge repeats the purchase date, so comparing any date
    // to any date made September's instalment a "duplicate" of May's.
    const may = existing({ expense_date: "2026-05-02", transaction_date: "2026-04-21", amount: 270.33, description: "אנקור רכב חובה" });
    const august = findDuplicate(
      { amount: 270.33, billingDate: "2026-08-02", txnDate: "2026-04-21", description: "אנקור רכב חובה" },
      [may],
      3
    );
    expect(august).toBeNull();
  });

  it("still matches the same charge when both sides are fully dated", () => {
    const prior = existing({ expense_date: "2026-08-02", transaction_date: "2026-04-21", amount: 270.33, description: "אנקור רכב חובה" });
    const again = findDuplicate(
      { amount: 270.33, billingDate: "2026-08-03", txnDate: "2026-04-21", description: "אנקור רכב חובה" },
      [prior],
      3
    );
    expect(again).toBe(prior);
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

describe("extractCardName — card-section divider detection", () => {
  it("recognizes a divider row", () => {
    expect(extractCardName(["חשבון כרטיסי: 176606 שם כרטיס: ויזה כאל זהב ארבע ספרות אחרונות 9557"])).toBe(
      "ויזה כאל זהב 9557"
    );
  });

  it("does not misfire on a real header row", () => {
    expect(extractCardName(["שיוך", "סכום החיוב", "סכום העסקה", "בית העסק", "תאריך העסקה", "תאריך חיוב"])).toBeNull();
  });

  it("returns null for a blank row", () => {
    expect(extractCardName(["", "", ""])).toBeNull();
  });
});

describe("detectHeaderRow — never picks a card-section divider (regression)", () => {
  // Exact real-world layout that broke: row 0 is the card-title divider
  // (mostly blank besides the merged title text), row 1 is the true header,
  // row 2+ are data. Before the fix, detectHeaderRow defaulted to row 0
  // (nothing beat its initial bestScore=0), so every mapping dropdown showed
  // "(ריק)" and the merchant name never made it into the imported rows.
  const rows = [
    ["חשבון כרטיסי: 176606 שם כרטיס: ויזה כאל זהב ארבע ספרות אחרונות 9557"],
    ["שיוך", "סכום החיוב", "סכום העסקה", "בית העסק", "תאריך העסקה", "תאריך חיוב"],
    ["צדקה", "120", "120", "סועד פת שחרית", "02/07/2026", "02/08/2026"],
    ["בית", "15", "15", "מוסדות טעפליק", "08/06/2026", "02/08/2026"],
  ];

  it("skips the divider row and lands on the real header row", () => {
    expect(detectHeaderRow(rows)).toBe(1);
  });

  it("the resolved header row correctly locates every field column", () => {
    const header = rows[detectHeaderRow(rows)];
    expect(findColumn(header, FIELD_TOKENS.merchant)).toBe(3); // בית העסק
    expect(findColumn(header, FIELD_TOKENS.amount)).toBe(1); // סכום החיוב
    expect(findColumn(header, FIELD_TOKENS.date)).toBe(5); // תאריך חיוב
    expect(findColumn(header, FIELD_TOKENS.txnDate)).toBe(4); // תאריך העסקה
  });

  it("falls back to the first non-divider row when nothing scores at all", () => {
    expect(
      detectHeaderRow([
        ["חשבון כרטיסי: 1 שם כרטיס: כרטיס א ספרות אחרונות 1111"],
        ["", "", ""],
        ["", "", ""],
      ])
    ).toBe(1);
  });

  it("a normal file with the header genuinely on row 0 still works", () => {
    expect(
      detectHeaderRow([
        ["תאריך חיוב", "שם בית עסק", "סכום חיוב"],
        ["01/06/2026", "סופר", "100"],
      ])
    ).toBe(0);
  });
});

// A bank export with account lines above the header and the card as a column on
// each line; no bank-date column. Merchants are made up.
const BANK_LAYOUT = [
  ["חשבון: 0001112223 | ישראל ישראלי", "", "", "", ""],
  ["הקודם: 111-0000-00-000000", "", "", "", ""],
  ["N/A", "", "", "", ""],
  ["פירוט עסקאות - כל הכרטיסים הבנקאיים", "", "", "", ""],
  ["3 עסקאות לחיוב הקודם", "", "", "", ""],
  ['עסקאות באשראי - סה"כ חיוב: + ₪460.5', "", "", "", ""],
  ["כרטיס", "בית עסק", "תאריך עסקה", "סכום העסקה", "שיוך"],
  ["מאסטרכארד 1234", "מאפיית הדוגמה", "28/08/2026", "₪200.00", "בית"],
  ["מאסטרכארד 1234", "חנות לדוגמה", "27/08/2026", "₪160.50", "בית"],
  ["מאסטרכארד 1234", "ספק בדוי", "26/08/2026", " ₪100.00", ""],
];

// A card export with two empty rows, then a header with no card column and no
// bank-date column, and both a purchase amount and a charge amount.
const PURCHASE_ONLY_LAYOUT = [
  ["", "", "", "", ""],
  ["", "", "", "", ""],
  ["תאריך העסקה", "בית העסק", "סכום העסקה", "סכום החיוב", "שיוך"],
  ["02/08/2026", "מסעדה לדוגמה", "120", "120", "צדקה"],
  ["04/08/2026", "דמי כרטיס", "0", "-8.4", ""],
];

describe("card column", () => {
  it("finds a per-line card column", () => {
    expect(findColumn(BANK_LAYOUT[6], FIELD_TOKENS.card)).toBe(0);
    expect(findColumn(["מספר כרטיס", "תאריך עסקה", "סכום"], FIELD_TOKENS.card)).toBe(0);
  });

  it("finds none when the file has no card column", () => {
    expect(findColumn(PURCHASE_ONLY_LAYOUT[2], FIELD_TOKENS.card)).toBe(-1);
    expect(
      findColumn(["שיוך", "סכום החיוב", "סכום העסקה", "בית העסק", "תאריך העסקה", "תאריך חיוב"], FIELD_TOKENS.card)
    ).toBe(-1);
  });
});

describe("detectHeaderRow — layouts without card-section rows", () => {
  it("skips the bank's account lines and lands on the header", () => {
    expect(detectHeaderRow(BANK_LAYOUT)).toBe(6);
  });

  it("skips leading empty rows", () => {
    expect(detectHeaderRow(PURCHASE_ONLY_LAYOUT)).toBe(2);
  });
});

describe("findBankDateColumn — the bank charge date, never the purchase date", () => {
  it("finds no bank date in the bank layout, while the purchase date is found", () => {
    const header = BANK_LAYOUT[6];
    expect(findBankDateColumn(header)).toBe(-1);
    expect(findColumn(header, FIELD_TOKENS.txnDate)).toBe(2);
  });

  it("finds no bank date in the purchase-only layout, while the purchase date is found", () => {
    const header = PURCHASE_ONLY_LAYOUT[2];
    expect(findBankDateColumn(header)).toBe(-1);
    expect(findColumn(header, FIELD_TOKENS.txnDate)).toBe(0);
  });

  it("Cal layout with both dates still picks תאריך חיוב", () => {
    const header = ["שיוך", "סכום החיוב", "סכום העסקה", "בית העסק", "תאריך העסקה", "תאריך חיוב"];
    expect(findBankDateColumn(header)).toBe(5);
    expect(findBankDateColumn(["תאריך עסקה", "שם בית עסק", "סכום", "מועד חיוב"])).toBe(3);
  });

  it("a lone generic date column that isn't the purchase date is still the bank date", () => {
    expect(findBankDateColumn(["תאריך", "שם בית עסק", "סכום חיוב"])).toBe(0);
  });
});

describe("amount column", () => {
  it("prefers the charge amount (סכום החיוב) over the purchase amount (סכום העסקה)", () => {
    expect(findColumn(PURCHASE_ONLY_LAYOUT[2], FIELD_TOKENS.amount)).toBe(3);
  });

  it("falls back to the purchase amount when there is no charge amount", () => {
    expect(findColumn(BANK_LAYOUT[6], FIELD_TOKENS.amount)).toBe(3);
  });
});

describe("findStatementTotal", () => {
  it("reads the bank's total line above the header", () => {
    const rows = [['עסקאות באשראי - סה"כ חיוב: + ₪3104.9'], ["כרטיס", "בית עסק", "תאריך עסקה", "סכום העסקה"]];
    expect(findStatementTotal(rows, 1)).toBe(3104.9);
  });

  it("reads thousands separators and the ״ quote form", () => {
    expect(findStatementTotal([["סה״כ חיוב: ₪3,104.90"], ["header"]], 1)).toBe(3104.9);
    expect(findStatementTotal([["סה'כ חיוב", "₪3,104.90"], ["header"]], 1)).toBe(3104.9);
  });

  it("a minus sign makes it negative", () => {
    expect(findStatementTotal([['סה"כ חיוב: -₪12.5'], ["header"]], 1)).toBe(-12.5);
    expect(findStatementTotal([['סה"כ חיוב: ₪12.50-'], ["header"]], 1)).toBe(-12.5);
  });

  it("skips a date before the amount", () => {
    expect(findStatementTotal([['סה"כ חיוב ל-10/09/2026: ₪99.90'], ["header"]], 1)).toBe(99.9);
  });

  it("returns null when there is no total, and ignores rows below the header", () => {
    expect(findStatementTotal(PURCHASE_ONLY_LAYOUT, 2)).toBeNull();
    expect(findStatementTotal([["header"], ['סה"כ חיוב: ₪10']], 0)).toBeNull();
  });

  it("finds the total in the bank layout", () => {
    expect(findStatementTotal(BANK_LAYOUT, detectHeaderRow(BANK_LAYOUT))).toBe(460.5);
  });
});

describe("nextChargeDate", () => {
  it("the next charge day after the latest purchase", () => {
    expect(nextChargeDate("2026-08-28", 2)).toBe("2026-09-02");
    expect(nextChargeDate("2026-08-05", 10)).toBe("2026-08-10");
  });

  it("clamps to the month's last day", () => {
    expect(nextChargeDate("2026-02-10", 31)).toBe("2026-02-28");
    expect(nextChargeDate("2026-02-28", 31)).toBe("2026-03-31");
  });

  it("rolls December over to January", () => {
    expect(nextChargeDate("2026-12-20", 10)).toBe("2027-01-10");
  });

  it("a purchase on the charge day itself goes to next month", () => {
    expect(nextChargeDate("2026-08-10", 10)).toBe("2026-09-10");
  });

  it("returns empty for unusable input", () => {
    expect(nextChargeDate("", 10)).toBe("");
    expect(nextChargeDate("2026-08-10", 0)).toBe("");
  });
});

describe("isRealCardLabel", () => {
  it("rejects empty and the generic fallback", () => {
    expect(isRealCardLabel("")).toBe(false);
    expect(isRealCardLabel("  ")).toBe(false);
    expect(isRealCardLabel("כרטיס אשראי")).toBe(false);
    expect(isRealCardLabel("ויזה 1234")).toBe(true);
  });
});

describe("buildKnownCards", () => {
  it("unions every source by normalized label, drops the fallback, sorts, and takes the latest charge day", () => {
    const cards = buildKnownCards({
      mappings: [{ card_label: "ויזה 1234", account_name: "בנק א" }],
      charges: [
        { card_label: "ויזה 1234", charge_date: "2026-07-02" },
        { card_label: "ויזה  1234", charge_date: "2026-08-10" },
        { card_label: "מאסטרכארד 5678", charge_date: "2026-08-15" },
      ],
      rowLabels: ["כרטיס אשראי", "", null, "אמריקן 9999", "ויזה 1234"],
    });
    expect(cards.map((c) => c.label)).toEqual(["אמריקן 9999", "ויזה 1234", "מאסטרכארד 5678"]);
    expect(cards.find((c) => c.label === "ויזה 1234")).toEqual({ label: "ויזה 1234", chargeDay: 10, accountName: "בנק א" });
    expect(cards.find((c) => c.label === "מאסטרכארד 5678")?.chargeDay).toBe(15);
    expect(cards.find((c) => c.label === "אמריקן 9999")?.chargeDay).toBeNull();
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

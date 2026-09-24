import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  FALLBACK_DOCUMENT_CATEGORIES,
  categoriesTrackingExpiry,
  categoryLabel,
  fetchDocumentCategories,
  moneyCategoryCodes,
  requiredCategoriesFor,
  selectableCategories,
  type DocumentCategoryRow,
} from "@/lib/documents/categories";
import { isUnlinkedMoneyDocument } from "@/lib/documents/moneyLink";

// A stub shaped like the one call fetchDocumentCategories makes:
//   .from(table).select(cols).order(col, opts) -> { data, error }
function fakeClient(result: { data: unknown; error: unknown }) {
  return {
    from: () => ({
      select: () => ({
        order: () => Promise.resolve(result),
      }),
    }),
  } as unknown as SupabaseClient;
}

function row(patch: Partial<DocumentCategoryRow> & { code: string }): DocumentCategoryRow {
  return {
    label: patch.code,
    kind: "user",
    tracks_expiry: false,
    expiry_lead_days: 30,
    required_for: [],
    is_money_doc: false,
    is_photo: false,
    active: true,
    sort_order: 0,
    ...patch,
  };
}

describe("fetchDocumentCategories — tolerance", () => {
  it("falls back to the seeded defaults when the table does not exist yet", async () => {
    const result = await fetchDocumentCategories(
      fakeClient({ data: null, error: { message: 'relation "public.document_categories" does not exist' } })
    );
    expect(result).toEqual(FALLBACK_DOCUMENT_CATEGORIES);
  });

  it("falls back when the table exists but is empty", async () => {
    const result = await fetchDocumentCategories(fakeClient({ data: [], error: null }));
    expect(result).toEqual(FALLBACK_DOCUMENT_CATEGORIES);
  });

  it("normalizes rows and drops ones with no code", async () => {
    const result = await fetchDocumentCategories(
      fakeClient({
        data: [
          { code: "ביטוח", label: "ביטוח", kind: "user", tracks_expiry: true, expiry_lead_days: 45 },
          { code: "   ", label: "junk" },
          { code: "vehicle_photo", label: "צילום רכב", kind: "system", is_photo: true },
        ],
        error: null,
      })
    );
    expect(result.map((r) => r.code)).toEqual(["ביטוח", "vehicle_photo"]);
    expect(result[0]).toMatchObject({ tracks_expiry: true, expiry_lead_days: 45, kind: "user" });
    // Missing booleans default to false rather than undefined.
    expect(result[1]).toMatchObject({ kind: "system", is_photo: true, tracks_expiry: false });
  });

  it("clamps an out-of-range lead time instead of trusting it", async () => {
    const result = await fetchDocumentCategories(
      fakeClient({ data: [{ code: "ביטוח", expiry_lead_days: 9999 }], error: null })
    );
    expect(result[0]?.expiry_lead_days).toBe(365);
  });
});

describe("the seeded fallback matches the decisions taken for the migration", () => {
  it("tracks expiry on exactly ביטוח, תעודה/רישיון and חוזה/הסכם", () => {
    expect(categoriesTrackingExpiry(FALLBACK_DOCUMENT_CATEGORIES).map((r) => r.code).sort()).toEqual(
      ["ביטוח", "חוזה/הסכם", "תעודה/רישיון"].sort()
    );
  });

  it("requires documents for vehicles and properties only", () => {
    expect(requiredCategoriesFor(FALLBACK_DOCUMENT_CATEGORIES, "vehicle").map((r) => r.code)).toEqual([
      "ביטוח",
      "תעודה/רישיון",
    ]);
    expect(requiredCategoriesFor(FALLBACK_DOCUMENT_CATEGORIES, "property").map((r) => r.code)).toEqual([
      "מסמכי רכישה",
      "נסח טאבו",
    ]);
    expect(requiredCategoriesFor(FALLBACK_DOCUMENT_CATEGORIES, "project")).toEqual([]);
    expect(requiredCategoriesFor(FALLBACK_DOCUMENT_CATEGORIES, "customer")).toEqual([]);
  });

  it("marks the money documents", () => {
    const money = moneyCategoryCodes(FALLBACK_DOCUMENT_CATEGORIES);
    expect(money.has("חשבונית")).toBe(true);
    expect(money.has("קבלה")).toBe(true);
    expect(money.has("צק")).toBe(true);
    expect(money.has("צילום")).toBe(false);
  });
});

describe("selectableCategories", () => {
  it("offers only active, user-facing rows — system codes are labels, not choices", () => {
    const rows = [
      row({ code: "ביטוח" }),
      row({ code: "task_attachment", kind: "system" }),
      row({ code: "צילום", active: false }),
    ];
    expect(selectableCategories(rows).map((r) => r.code)).toEqual(["ביטוח"]);
  });
});

describe("categoryLabel — the code/label invariant", () => {
  const rows = [row({ code: "ביטוח", label: "פוליסת ביטוח" })];

  it("renames come from the registry without changing what is stored", () => {
    // The row still stores "ביטוח"; only the display changed.
    expect(categoryLabel(rows, "ביטוח")).toBe("פוליסת ביטוח");
  });

  it("falls back to the legacy hardcoded map for codes the registry lacks", () => {
    expect(categoryLabel(rows, "card_statement")).toBe("דף חיוב אשראי");
    expect(categoryLabel(rows, "morning_305")).toBe("חשבונית מס");
  });

  it("keeps free text readable and names the empty case", () => {
    expect(categoryLabel(rows, "משהו שהוקלד פעם")).toBe("משהו שהוקלד פעם");
    expect(categoryLabel(rows, "")).toBe("ללא קטגוריה");
    expect(categoryLabel(rows, null)).toBe("ללא קטגוריה");
  });
});

describe("isUnlinkedMoneyDocument", () => {
  const money = new Set(["חשבונית", "צק"]);

  it("flags a money document with no ledger link", () => {
    expect(isUnlinkedMoneyDocument("חשבונית", ["customer", "project"], money)).toBe(true);
  });

  it("does not flag one that is already tied to an expense or a payment", () => {
    expect(isUnlinkedMoneyDocument("חשבונית", ["customer", "expense"], money)).toBe(false);
    expect(isUnlinkedMoneyDocument("צק", ["payment"], money)).toBe(false);
  });

  it("ignores documents that are not money at all", () => {
    expect(isUnlinkedMoneyDocument("ביטוח", [], money)).toBe(false);
    expect(isUnlinkedMoneyDocument("", [], money)).toBe(false);
    expect(isUnlinkedMoneyDocument(null, [], money)).toBe(false);
  });
});

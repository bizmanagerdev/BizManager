import { describe, it, expect } from "vitest";
import {
  cardTitle,
  compareGroups,
  documentYear,
  entityChipParts,
  entityTypeLabel,
  facetTriggerLabel,
  fileKindLabel,
  formatDate,
  groupLabel,
  isControlledCategory,
  normalizeText,
  setKeyFor,
} from "@/app/(app)/documents/DocumentsArchiveClient.helpers";
import { getDocumentCategoryLabel } from "@/lib/documents";
import { getBusinessDomainLabel } from "@/lib/expenses";

// ────────────────────────────────────────────────────────────────────────────
// Characterization tests for the documents archive's pure helpers.
//
// The project rule is that these exist BEFORE a god-file is split. They did not
// here: DocumentsArchiveClient was split first, and the helpers that already had
// coverage (sorting, packing, collapsing, drop targets) were the lucky ones.
// These lock the rest to what shipped, so the next change to any of them is a
// decision rather than an accident.
//
// The ordering helpers (sortDocuments, documentTime, packGroups, collapseSets,
// groupHref, groupDropTarget) are covered in __tests__/app/documents-sort.test.ts.
// ────────────────────────────────────────────────────────────────────────────

/** A document with every field the helpers read, overridable per test. */
const doc = (over: Record<string, unknown> = {}) =>
  ({
    id: "d-1",
    title: "תעודה/רישיון · טנדר אפור",
    file_name: null,
    document_type: "תעודה/רישיון",
    source: null,
    valid_until: null,
    no_link_needed: false,
    file_kind: "pdf",
    storage_key: null,
    uploaded_at: "2026-09-18T08:43:00Z",
    created_at: null,
    uploaded_by_name: null,
    uploaded_by_color: null,
    url: null,
    entity_types: [],
    linked_entities: [],
    customers: [],
    projects: [],
    properties: [],
    tasks: [],
    orders: [],
    business_domains: [],
    ref_year: null,
    tags: [],
    search_text: "",
    ...over,
  }) as never;

describe("normalizeText", () => {
  it("trims and lower-cases, which is all search matching relies on", () => {
    expect(normalizeText("  PDF  ")).toBe("pdf");
    expect(normalizeText("ביטוח")).toBe("ביטוח");
    expect(normalizeText("")).toBe("");
  });
});

describe("cardTitle", () => {
  it("drops the half of the title the tray heading already says", () => {
    expect(cardTitle(doc({ title: "צילום משלוח · קהילת צמאה נפשי" }), "קהילת צמאה נפשי")).toBe(
      "צילום משלוח"
    );
  });

  it("keeps the whole title when the heading is not part of it", () => {
    expect(cardTitle(doc({ title: "צילום משלוח · קהילת צמאה נפשי" }), "טנדר אפור")).toBe(
      "צילום משלוח · קהילת צמאה נפשי"
    );
  });

  it("keeps a single-part title, and the whole title under an empty heading", () => {
    expect(cardTitle(doc({ title: "חוזה" }), "חוזה")).toBe("חוזה");
    expect(cardTitle(doc({ title: "צילום · טנדר" }), "")).toBe("צילום · טנדר");
  });
});

describe("entityChipParts", () => {
  it("says the kind once when the server already put it in the label", () => {
    // The stutter that reached production twice: "הזמנה: הזמנה · בית גדליה".
    expect(entityChipParts("order", "הזמנה · בית גדליה")).toEqual(["הזמנה", "בית גדליה"]);
  });

  it("prefixes the kind when the label does not carry it", () => {
    expect(entityChipParts("customer", "בית גדליה")).toEqual(["לקוח", "בית גדליה"]);
  });

  it("does not repeat a label that is only the kind", () => {
    expect(entityChipParts("order", "הזמנה")).toEqual(["הזמנה"]);
  });
});

describe("setKeyFor", () => {
  it("keys the same paper by entity, category and expiry date", () => {
    expect(
      setKeyFor(doc({ valid_until: "2027-01-01", tags: [{ id: "veh-1", label: "טנדר" }] }))
    ).toBe("same|veh-1|תעודה/רישיון|2027-01-01");
  });

  it("falls back to the upload minute when there is no date to share", () => {
    expect(setKeyFor(doc({ uploaded_at: "2026-09-18T08:43:27Z" }))).toBe(
      "upload|2026-09-18T08:43|תעודה/רישיון|"
    );
  });

  it("has no key for a document with no date of any kind", () => {
    expect(setKeyFor(doc({ uploaded_at: null }))).toBeNull();
  });
});

describe("groupLabel", () => {
  it("names the entity in the order people remember it: project, car, property, customer", () => {
    const all = {
      projects: [{ id: "p", label: "פרויקט" }],
      tags: [{ id: "t", label: "טנדר" }],
      properties: [{ id: "pr", label: "נכס" }],
      customers: [{ id: "c", label: "לקוח" }],
    };
    expect(groupLabel("entity", doc(all))).toBe("פרויקט");
    expect(groupLabel("entity", doc({ ...all, projects: [] }))).toBe("טנדר");
    expect(groupLabel("entity", doc({ ...all, projects: [], tags: [] }))).toBe("נכס");
    expect(groupLabel("entity", doc({ customers: all.customers }))).toBe("לקוח");
  });

  it("separates a deliberate absence of a link from a missing one", () => {
    expect(groupLabel("entity", doc())).toBe("ללא שיוך");
    expect(groupLabel("entity", doc({ no_link_needed: true }))).toBe("ללא שיוך נדרש");
  });

  it("delegates the other groupings to their own labels", () => {
    expect(groupLabel("type", doc())).toBe(getDocumentCategoryLabel("תעודה/רישיון"));
    expect(groupLabel("kind", doc())).toBe("PDF");
    expect(groupLabel("customer", doc())).toBe("ללא לקוח");
    expect(groupLabel("domain", doc())).toBe(getBusinessDomainLabel("general_business"));
  });

  it("groups by month as MM/YYYY, and by nothing as one bucket", () => {
    expect(groupLabel("date", doc({ uploaded_at: "2026-09-18T08:43:00Z" }))).toBe("09/2026");
    expect(groupLabel("date", doc({ uploaded_at: null }))).toBe("ללא תאריך");
    expect(groupLabel("anything-else", doc())).toBe("כל המסמכים");
  });
});

describe("documentYear", () => {
  it("prefers the year the document is about over the year it arrived", () => {
    expect(documentYear(doc({ ref_year: 2024 }))).toBe("2024");
  });

  it("falls back to the upload year, then the link's, then nothing", () => {
    expect(documentYear(doc())).toBe("2026");
    expect(documentYear(doc({ uploaded_at: null, created_at: "2025-03-01" }))).toBe("2025");
    expect(documentYear(doc({ uploaded_at: null, created_at: null }))).toBe("");
  });

  it("ignores a zero or garbage year rather than filtering on it", () => {
    expect(documentYear(doc({ ref_year: 0 }))).toBe("2026");
    expect(documentYear(doc({ uploaded_at: "not-a-date" }))).toBe("");
  });
});

describe("compareGroups", () => {
  const group = (label: string, dates: string[]) => ({
    label,
    items: dates.map((uploaded_at, i) => doc({ id: `${label}-${i}`, uploaded_at })),
  });

  it("orders sections by their newest document under החדשים", () => {
    const older = group("א", ["2026-01-01T00:00:00Z"]);
    const newer = group("ב", ["2026-09-01T00:00:00Z"]);
    expect([older, newer].sort((a, b) => compareGroups(a, b, "newest")).map((g) => g.label)).toEqual([
      "ב",
      "א",
    ]);
  });

  it("orders sections by their oldest document under הישנים", () => {
    const a = group("א", ["2026-05-01T00:00:00Z"]);
    const b = group("ב", ["2026-02-01T00:00:00Z", "2026-09-01T00:00:00Z"]);
    expect([a, b].sort((x, y) => compareGroups(x, y, "oldest")).map((g) => g.label)).toEqual([
      "ב",
      "א",
    ]);
  });

  it("orders sections by name for the name and category sorts", () => {
    const a = group("ב", ["2026-09-01T00:00:00Z"]);
    const b = group("א", ["2026-01-01T00:00:00Z"]);
    expect([a, b].sort((x, y) => compareGroups(x, y, "name")).map((g) => g.label)).toEqual(["א", "ב"]);
  });
});

describe("facetTriggerLabel", () => {
  const options = [
    { key: "a", label: "הזמנות", count: 145 },
    { key: "b", label: "רכבים", count: 12 },
  ];

  it("is just the facet's name when nothing is chosen", () => {
    expect(facetTriggerLabel("שיוך", new Set(), options)).toBe("שיוך");
  });

  it("names a single choice with its count", () => {
    expect(facetTriggerLabel("שיוך", new Set(["a"]), options)).toBe("שיוך: הזמנות (145)");
  });

  it("counts several choices rather than listing them", () => {
    expect(facetTriggerLabel("שיוך", new Set(["a", "b"]), options)).toBe("שיוך: 2 נבחרו");
  });

  it("falls back to the bare name for a choice it has no option for", () => {
    expect(facetTriggerLabel("שיוך", new Set(["gone"]), options)).toBe("שיוך");
  });
});

describe("labels", () => {
  it("names every entity kind a document can attach to", () => {
    expect(entityTypeLabel("order")).toBe("הזמנה");
    expect(entityTypeLabel("vehicle")).toBe("רכב");
    expect(entityTypeLabel("loan")).toBe("הלוואה");
    expect(entityTypeLabel("")).toBe("ללא שיוך");
    // An unknown kind is shown as itself rather than hidden.
    expect(entityTypeLabel("mystery")).toBe("mystery");
  });

  it("names file kinds, with one bucket for everything unrecognised", () => {
    expect(fileKindLabel("pdf")).toBe("PDF");
    expect(fileKindLabel("image")).toBe("תמונה");
    expect(fileKindLabel("anything")).toBe("אחר");
  });

  it("recognises only the controlled categories as controlled", () => {
    expect(isControlledCategory("ביטוח")).toBe(true);
    expect(isControlledCategory("vehicle_photo")).toBe(false);
    expect(isControlledCategory(null)).toBe(false);
  });

  it("shows a dash for a missing date rather than an empty cell", () => {
    expect(formatDate(null)).toBe("—");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// The order of the TRAYS must agree with the order INSIDE them.
//
// compareGroups compared uploaded_at as strings while sortDocuments parsed it,
// so the page ran two ordering rules — the bug already reported once for the
// documents themselves. Strings fail in exactly the ways that occur here: a
// timestamp with a +03:00 offset against one in UTC, and Postgres's
// space-separated form against ISO's T.
// ────────────────────────────────────────────────────────────────────────────
describe("compareGroups — agrees with the documents inside", () => {
  const tray = (label: string, items: Array<Record<string, unknown>>) => ({
    label,
    items: items.map((over, i) => doc({ id: `${label}-${i}`, ...over })),
  });
  const order = (sortBy: string, ...trays: ReturnType<typeof tray>[]) =>
    [...trays].sort((a, b) => compareGroups(a, b, sortBy)).map((t) => t.label);

  it("compares instants, not text, across time zones", () => {
    // 23:00 in Israel is 20:00 UTC — an hour BEFORE 21:00 UTC, though the
    // string "23" sorts after "21".
    const israel = tray("ישראל", [{ uploaded_at: "2026-09-18T23:00:00+03:00" }]);
    const utc = tray("UTC", [{ uploaded_at: "2026-09-18T21:00:00Z" }]);
    expect(order("newest", israel, utc)).toEqual(["UTC", "ישראל"]);
  });

  it("compares instants, not text, across Postgres and ISO formats", () => {
    // A space sorts before a T, so any space-form timestamp read as older than
    // every ISO one on the same day, whatever the hour.
    const evening = tray("ערב", [{ uploaded_at: "2026-09-18 22:00:00+00" }]);
    const morning = tray("בוקר", [{ uploaded_at: "2026-09-18T08:00:00Z" }]);
    expect(order("newest", morning, evening)).toEqual(["ערב", "בוקר"]);
  });

  it("does not let an undated document make a tray the oldest", () => {
    // The reduce reset to "" whenever an undated document came LAST, so the
    // answer depended on the order of the array.
    const withGap = tray("חסר", [{ uploaded_at: "2026-09-01T00:00:00Z" }, { uploaded_at: null }]);
    const plain = tray("רגיל", [{ uploaded_at: "2026-05-01T00:00:00Z" }]);
    expect(order("oldest", withGap, plain)).toEqual(["רגיל", "חסר"]);
  });

  it("sinks a tray with no dates at all, in both directions", () => {
    const undated = tray("ללא", [{ uploaded_at: null }]);
    const dated = tray("עם", [{ uploaded_at: "2026-01-01T00:00:00Z" }]);
    expect(order("newest", undated, dated)).toEqual(["עם", "ללא"]);
    expect(order("oldest", undated, dated)).toEqual(["עם", "ללא"]);
  });

  it("orders trays by their soonest expiry under תוקף קרוב", () => {
    // Inside a tray the documents already sort by expiry; the trays fell back
    // to upload date. Upload dates here are chosen to disagree on purpose.
    const later = tray("מאוחר", [{ valid_until: "2027-06-01", uploaded_at: "2026-09-20T00:00:00Z" }]);
    const sooner = tray("קרוב", [{ valid_until: "2026-11-01", uploaded_at: "2026-01-01T00:00:00Z" }]);
    const none = tray("ללא תוקף", [{ valid_until: null, uploaded_at: "2026-06-01T00:00:00Z" }]);
    expect(order("expiry", later, none, sooner)).toEqual(["קרוב", "מאוחר", "ללא תוקף"]);
  });
});

import { describe, it, expect } from "vitest";
import {
  sortDocuments,
  documentTime,
  groupHref,
  groupDropTarget,
  packGroups,
  collapseSets,
} from "@/app/(app)/documents/DocumentsArchiveClient.helpers";

// The reported bug: a document dated 18/09 rendered after three dated 10/09
// under "מיון: החדשים". Sorting compared uploaded_at as STRINGS, which only
// works while every row carries the same timestamp format — and rows that fall
// back to a link's created_at do not.

type Doc = { id: string; uploaded_at: string | null };
const doc = (id: string, uploaded_at: string | null) => ({ id, uploaded_at }) as never;

describe("documentTime", () => {
  it("parses both a full ISO timestamp and a bare date", () => {
    expect(documentTime({ uploaded_at: "2026-09-18T08:43:00Z" })).toBe(
      Date.parse("2026-09-18T08:43:00Z")
    );
    expect(documentTime({ uploaded_at: "2026-09-18" })).toBe(Date.parse("2026-09-18"));
  });

  it("returns null for missing or unparseable values", () => {
    expect(documentTime({ uploaded_at: null })).toBeNull();
    expect(documentTime({ uploaded_at: "  " })).toBeNull();
    expect(documentTime({ uploaded_at: "not a date" })).toBeNull();
  });
});

describe("sortDocuments", () => {
  it("puts the newest first, across mixed timestamp formats", () => {
    const items = [
      doc("a", "2026-09-10T12:48:00Z"),
      doc("b", "2026-09-10T11:53:00Z"),
      doc("c", "2026-09-18"),
      doc("d", "2026-09-10T09:52:00Z"),
    ];
    expect(sortDocuments(items, "newest").map((d: Doc) => d.id)).toEqual(["c", "a", "b", "d"]);
  });

  it("reverses cleanly for oldest-first", () => {
    const items = [doc("new", "2026-09-18T00:00:00Z"), doc("old", "2026-01-01T00:00:00Z")];
    expect(sortDocuments(items, "oldest").map((d: Doc) => d.id)).toEqual(["old", "new"]);
  });

  it("sinks undated documents to the bottom in BOTH directions", () => {
    const items = [doc("none", null), doc("dated", "2026-09-18T00:00:00Z")];
    expect(sortDocuments(items, "newest").map((d: Doc) => d.id)).toEqual(["dated", "none"]);
    expect(sortDocuments(items, "oldest").map((d: Doc) => d.id)).toEqual(["dated", "none"]);
  });

  it("never mutates its input — it is the memoised filter result", () => {
    const items = [doc("a", "2026-01-01"), doc("b", "2026-09-01")];
    const before = items.map((d: Doc) => d.id);
    sortDocuments(items, "newest");
    expect(items.map((d: Doc) => d.id)).toEqual(before);
  });
});

// A heading names a real thing, so it links to it. The trap: a customer is
// usually known through an ORDER or a project, never through a document_link of
// its own — so resolving the address from the link rows returned null for
// exactly the headings that matter, and every delivery-photo section was a dead
// end that still looked fine.
describe("groupHref", () => {
  const base = {
    projects: [],
    tags: [],
    properties: [],
    customers: [],
    linked_entities: [],
  };

  it("links a customer known only through their order", () => {
    const doc = {
      ...base,
      customers: [{ id: "c-1", label: "חנות קלמנס", href: "/customers/c-1" }],
      linked_entities: [
        { type: "order", id: "o-9", label: "הזמנה 9", href: "/sales/orders/o-9" },
      ],
    } as never;
    expect(groupHref("entity", doc)).toBe("/customers/c-1");
    expect(groupHref("customer", doc)).toBe("/customers/c-1");
  });

  it("prefers the entity the heading actually named", () => {
    const doc = {
      ...base,
      projects: [{ id: "p-1", label: "פרויקט", href: "/projects/p-1?tab=documents" }],
      customers: [{ id: "c-1", label: "לקוח", href: "/customers/c-1" }],
    } as never;
    expect(groupHref("entity", doc)).toBe("/projects/p-1?tab=documents");
  });

  it("falls back to a linked row when no relation is named", () => {
    const doc = {
      ...base,
      linked_entities: [{ type: "task", id: "t-1", label: "משימה", href: "/tasks/t-1" }],
    } as never;
    expect(groupHref("entity", doc)).toBe("/tasks/t-1");
  });

  it("has nowhere to go when grouping is not by an entity", () => {
    const doc = { ...base, customers: [{ id: "c-1", label: "x", href: "/customers/c-1" }] } as never;
    expect(groupHref("type", doc)).toBeNull();
    expect(groupHref("kind", doc)).toBeNull();
  });
});

// Rows that stopped short of the edge: a three-tile group could not fit the two
// columns left over, so the row ended there and the space stayed empty while a
// single-photo group sat waiting on the next line.
describe("packGroups", () => {
  it("pulls a group that fits into the space left at the end of a row", () => {
    // 4 columns: [3] fills three, [3] cannot follow, [1] can.
    expect(packGroups([3, 3, 1], 4)).toEqual([0, 2, 1]);
  });

  it("keeps the original order when every group already fits", () => {
    expect(packGroups([2, 2, 2, 2], 4)).toEqual([0, 1, 2, 3]);
  });

  it("does not reach further than the lookahead for a filler", () => {
    // The 1 is five places away, so the row ends rather than hauling it up.
    const order = packGroups([3, 3, 3, 3, 3, 1], 4, 3);
    expect(order[0]).toBe(0);
    expect(order[1]).toBe(1);
  });

  it("renders every group exactly once", () => {
    const spans = [1, 3, 2, 1, 4, 2, 1];
    const order = packGroups(spans, 5);
    expect([...order].sort((a, b) => a - b)).toEqual(spans.map((_, i) => i));
  });

  it("survives a degenerate column count", () => {
    expect(packGroups([1, 1], 0)).toEqual([0, 1]);
  });
});

// Dropping files onto a tray should answer "where does this go?" with the tray
// itself — but only where the upload can actually carry that answer.
describe("groupDropTarget", () => {
  const base = { projects: [], properties: [], customers: [], business_domains: [], document_type: null };

  it("names the entity the heading named, in the same order", () => {
    expect(
      groupDropTarget("entity", {
        ...base,
        projects: [{ id: "p-1", label: "פרויקט" }],
        customers: [{ id: "c-1", label: "לקוח" }],
      } as never)
    ).toEqual({ kind: "project", id: "p-1" });

    expect(
      groupDropTarget("entity", { ...base, customers: [{ id: "c-1", label: "לקוח" }] } as never)
    ).toEqual({ kind: "customer", id: "c-1" });
  });

  it("carries the category or the domain when that is what the grouping means", () => {
    expect(groupDropTarget("type", { ...base, document_type: "צק" } as never)).toEqual({
      kind: "category",
      value: "צק",
    });
    expect(
      groupDropTarget("domain", { ...base, business_domains: ["sales"] } as never)
    ).toEqual({ kind: "domain", value: "sales" });
  });

  it("returns nothing when the tray names something an upload cannot be filed under", () => {
    // An order or a vehicle tray still takes the drop — it just cannot
    // pre-answer, and the dialog asks as usual rather than guessing.
    expect(groupDropTarget("entity", base as never)).toBeNull();
    expect(groupDropTarget("kind", { ...base, document_type: "צק" } as never)).toBeNull();
  });
});

// Three photographs of one insurance certificate are one policy. Three cards
// for it is three times the noise and three chances to renew the wrong one.
describe("collapseSets", () => {
  const doc = (over: Record<string, unknown>) =>
    ({
      id: "d",
      document_type: "ביטוח",
      valid_until: null,
      uploaded_at: "2026-09-01T10:00:00Z",
      linked_entities: [],
      tags: [],
      ...over,
    }) as never;

  it("merges the same paper scanned on different days", () => {
    const sets = collapseSets([
      doc({ id: "a", valid_until: "2027-01-01", tags: [{ id: "veh-1" }], uploaded_at: "2026-09-01T10:00:00Z" }),
      doc({ id: "b", valid_until: "2027-01-01", tags: [{ id: "veh-1" }], uploaded_at: "2026-09-08T14:00:00Z" }),
      doc({ id: "c", valid_until: "2027-01-01", tags: [{ id: "veh-1" }], uploaded_at: "2026-09-20T09:00:00Z" }),
    ]);
    expect(sets).toHaveLength(1);
    expect(sets[0]!.members.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps a renewal separate from what it replaced", () => {
    // Merging these would make the old policy vanish instead of being marked
    // הוחלף — and the supersession model depends on both being visible.
    const sets = collapseSets([
      doc({ id: "old", valid_until: "2026-01-01", tags: [{ id: "veh-1" }] }),
      doc({ id: "new", valid_until: "2027-01-01", tags: [{ id: "veh-1" }] }),
    ]);
    expect(sets).toHaveLength(2);
  });

  it("does not merge across cars or categories", () => {
    const sets = collapseSets([
      doc({ id: "a", valid_until: "2027-01-01", tags: [{ id: "veh-1" }] }),
      doc({ id: "b", valid_until: "2027-01-01", tags: [{ id: "veh-2" }] }),
      doc({ id: "c", valid_until: "2027-01-01", document_type: "תעודה/רישיון", tags: [{ id: "veh-1" }] }),
    ]);
    expect(sets).toHaveLength(3);
  });

  it("still groups one upload of undated files", () => {
    const sets = collapseSets([
      doc({ id: "a", document_type: "צילום", uploaded_at: "2026-09-01T10:00:00Z", tags: [{ id: "veh-1" }] }),
      doc({ id: "b", document_type: "צילום", uploaded_at: "2026-09-01T10:00:30Z", tags: [{ id: "veh-1" }] }),
    ]);
    expect(sets).toHaveLength(1);
    expect(sets[0]!.members).toHaveLength(2);
  });

  it("leaves unrelated undated files alone", () => {
    const sets = collapseSets([
      doc({ id: "a", uploaded_at: "2026-09-01T10:00:00Z" }),
      doc({ id: "b", uploaded_at: "2026-09-04T11:00:00Z" }),
    ]);
    expect(sets).toHaveLength(2);
  });
});

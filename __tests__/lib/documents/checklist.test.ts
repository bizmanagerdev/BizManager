import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getChecklistForEntity } from "@/lib/documents/checklist";

// The checklist's one real hazard: a vehicle's documents hang off `entity_tags`
// while every other entity uses `document_links`. Querying the wrong table
// returns no rows and reports every document as missing — which looks like a
// working feature, just permanently wrong. These tests pin the branch.

type Resp = { data: unknown[] | null; error: unknown };
/** maybeSingle() returns a row, not a list — the vehicles lookup uses it. */
type SingleResp = { data: unknown; error: unknown };

function fakeClient(
  byTable: Record<string, Resp | SingleResp>,
  seen: string[] = []
) {
  const client = {
    from: (table: string) => {
      seen.push(table);
      const resp = byTable[table] ?? { data: [], error: null };
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "order", "not", "lte", "range"]) {
        builder[m] = () => builder;
      }
      builder.maybeSingle = () => Promise.resolve(resp);
      builder.then = (onF: (v: Resp) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(resp as Resp).then(onF, onR);
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, seen };
}

// An empty document_categories response makes fetchDocumentCategories fall back
// to the seeded registry: ביטוח + תעודה/רישיון for vehicles, מסמכי רכישה +
// נסח טאבו for properties, nothing for projects or customers.

describe("getChecklistForEntity — required set comes from the registry", () => {
  it("returns nothing for an entity type with no required categories", async () => {
    const { client } = fakeClient({});
    expect(await getChecklistForEntity(client, "project", "p-1")).toEqual([]);
    expect(await getChecklistForEntity(client, "customer", "c-1")).toEqual([]);
  });

  it("returns nothing when no entity id is given", async () => {
    const { client } = fakeClient({});
    expect(await getChecklistForEntity(client, "vehicle", "")).toEqual([]);
  });

  it("lists the seeded vehicle requirements", async () => {
    const { client } = fakeClient({});
    const items = await getChecklistForEntity(client, "vehicle", "tag-1");
    expect(items.map((i) => i.code)).toEqual(["ביטוח", "תעודה/רישיון"]);
    expect(items.every((i) => i.present === false)).toBe(true);
  });

  it("lists the seeded property requirements", async () => {
    const { client } = fakeClient({});
    const items = await getChecklistForEntity(client, "property", "prop-1");
    expect(items.map((i) => i.code)).toEqual(["מסמכי רכישה", "נסח טאבו"]);
  });
});

describe("getChecklistForEntity — the resolution-path branch", () => {
  it("resolves a VEHICLE's documents through entity_tags, not document_links", async () => {
    const { client, seen } = fakeClient({
      entity_tags: { data: [{ entity_id: "doc-1" }], error: null },
      documents: {
        data: [{ id: "doc-1", document_type: "ביטוח", valid_until: "2027-01-01", uploaded_at: "2026-09-01" }],
        error: null,
      },
    });

    const items = await getChecklistForEntity(client, "vehicle", "tag-1");

    expect(seen).toContain("entity_tags");
    expect(seen).not.toContain("document_links");
    expect(items.find((i) => i.code === "ביטוח")).toMatchObject({
      present: true,
      documentId: "doc-1",
      validUntil: "2027-01-01",
    });
    // The other requirement is still outstanding.
    expect(items.find((i) => i.code === "תעודה/רישיון")?.present).toBe(false);
  });

  it("resolves a PROPERTY's documents through document_links, not entity_tags", async () => {
    const { client, seen } = fakeClient({
      document_links: { data: [{ document_id: "doc-9" }], error: null },
      documents: {
        data: [{ id: "doc-9", document_type: "נסח טאבו", uploaded_at: "2026-09-01" }],
        error: null,
      },
    });

    const items = await getChecklistForEntity(client, "property", "prop-1");

    expect(seen).toContain("document_links");
    expect(seen).not.toContain("entity_tags");
    expect(items.find((i) => i.code === "נסח טאבו")?.present).toBe(true);
    expect(items.find((i) => i.code === "מסמכי רכישה")?.present).toBe(false);
  });
});

describe("getChecklistForEntity — tolerance", () => {
  it("still reports presence when valid_until does not exist yet", async () => {
    let call = 0;
    const client = {
      from: (table: string) => {
        const builder: Record<string, unknown> = {};
        for (const m of ["select", "eq", "in", "order"]) builder[m] = () => builder;
        // The vehicles lookup for the cover photo; this car has none.
        builder.maybeSingle = () => Promise.resolve({ data: null, error: null });
        builder.then = (onF: (v: Resp) => unknown) => {
          if (table === "entity_tags") {
            return Promise.resolve({ data: [{ entity_id: "doc-1" }], error: null }).then(onF);
          }
          if (table === "documents") {
            call += 1;
            // First attempt asks for valid_until and fails; the retry succeeds.
            return call === 1
              ? Promise.resolve({ data: null, error: { code: "42703" } }).then(onF)
              : Promise.resolve({
                  data: [{ id: "doc-1", document_type: "ביטוח", uploaded_at: "2026-09-01" }],
                  error: null,
                }).then(onF);
          }
          return Promise.resolve({ data: [], error: null }).then(onF);
        };
        return builder;
      },
    } as unknown as SupabaseClient;

    const items = await getChecklistForEntity(client, "vehicle", "tag-1");
    expect(items.find((i) => i.code === "ביטוח")).toMatchObject({
      present: true,
      validUntil: null,
    });
  });

  it("reports everything missing rather than throwing when the link query fails", async () => {
    const { client } = fakeClient({
      entity_tags: { data: null, error: { message: "boom" } },
    });
    const items = await getChecklistForEntity(client, "vehicle", "tag-1");
    expect(items).toHaveLength(2);
    expect(items.every((i) => !i.present)).toBe(true);
  });
});


// A car's cover photo is NOT tagged — it hangs off `vehicles.photo_document_id`
// as a plain foreign key. The checklist reported "צילום חסר" for a vehicle that
// was displaying its photograph at the top of the same page.
describe("getChecklistForEntity — the vehicle cover photo", () => {
  const photoCategory = [
    {
      code: "צילום",
      label: "צילום",
      kind: "user",
      tracks_expiry: false,
      expiry_lead_days: 30,
      required_for: ["vehicle"],
      is_money_doc: false,
      is_photo: true,
      active: true,
      sort_order: 10,
    },
  ];

  it("finds a photo that is only referenced by the vehicle's own column", async () => {
    const { client } = fakeClient({
      document_categories: { data: photoCategory, error: null },
      entity_tags: { data: [], error: null },
      vehicles: { data: { photo_document_id: "doc-photo" }, error: null },
      documents: {
        data: [{ id: "doc-photo", document_type: "vehicle_photo", uploaded_at: "2026-09-18" }],
        error: null,
      },
    });
    const items = await getChecklistForEntity(client, "vehicle", "veh-1");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ code: "צילום", present: true, documentId: "doc-photo" });
  });

  it("counts a source-coded photo as satisfying the צילום category", async () => {
    // The upload routes write vehicle_photo / project_photo / order_delivery_image
    // and never the word צילום, so a literal comparison never matched.
    const { client } = fakeClient({
      document_categories: { data: photoCategory, error: null },
      entity_tags: { data: [{ entity_id: "doc-1" }], error: null },
      vehicles: { data: null, error: null },
      documents: {
        data: [{ id: "doc-1", document_type: "vehicle_photo", uploaded_at: "2026-09-18" }],
        error: null,
      },
    });
    const items = await getChecklistForEntity(client, "vehicle", "veh-1");
    expect(items[0]?.present).toBe(true);
  });

  it("still reports a missing photo when the vehicle has none", async () => {
    const { client } = fakeClient({
      document_categories: { data: photoCategory, error: null },
      entity_tags: { data: [], error: null },
      vehicles: { data: null, error: null },
      documents: { data: [], error: null },
    });
    const items = await getChecklistForEntity(client, "vehicle", "veh-1");
    expect(items[0]).toMatchObject({ present: false, documentId: null });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

// A lease's signed agreement attached to its lease as it goes up (lease_id) —
// one request, so a contract kept on the device with no signal reaches its
// lease too (owner, 2026-10-24). Only a lease of the same property.

const leaseUpdates: Array<{
  row: Record<string, unknown>;
  filters: Array<[string, unknown]>;
}> = [];
let leaseFound = true;

function supabase() {
  return {
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        remove: async () => ({ error: null }),
      }),
    },
    from: (table: string) => {
      if (table === "lease_agreements") {
        return {
          update: (row: Record<string, unknown>) => {
            const entry = { row, filters: [] as Array<[string, unknown]> };
            leaseUpdates.push(entry);
            const chain = {
              eq: (col: string, value: unknown) => (
                entry.filters.push([col, value]),
                chain
              ),
              select: () => chain,
              maybeSingle: async () => ({
                data: leaseFound ? { id: "l1" } : null,
                error: null,
              }),
            };
            return chain;
          },
        };
      }
      return { insert: async () => ({ error: null }) };
    },
  };
}

vi.mock("@/lib/auth/requireRouteAccess", () => ({
  requireRouteAccess: async () => ({
    ok: true,
    value: {
      supabase: supabase(),
      user: { id: "u1" },
      profile: { id: "u1", role: "admin" },
    },
  }),
}));
vi.mock("@/lib/idempotency", () => ({
  withIdempotency: (
    _req: Request,
    _s: unknown,
    _u: string,
    _e: string,
    handler: () => Promise<Response>,
  ) => handler(),
}));
vi.mock("@/lib/documents/insert", () => ({
  insertDocumentRow: async () => ({ error: null }),
}));
vi.mock("@/lib/documents/undoCreate", () => ({ undoDocumentCreate: vi.fn() }));
vi.mock("@/lib/tags", () => ({
  parseTagIds: () => [],
  syncEntityTags: vi.fn(),
}));
vi.mock("@/lib/audit-after", () => ({ logAuditEventAfterResponse: vi.fn() }));

import { POST } from "@/app/api/documents/upload/route";

const LEASE_ID = "0b8f7a52-6a3c-4f7e-9d61-3c2b1a0e9f11";

function upload(fields: Record<string, string>) {
  const form = new FormData();
  form.set("file", new File(["pdf"], "חוזה.pdf", { type: "application/pdf" }));
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return new Request("http://x/api/documents/upload", {
    method: "POST",
    body: form,
  });
}

beforeEach(() => {
  leaseUpdates.length = 0;
  leaseFound = true;
});

describe("a lease's contract going up", () => {
  it("attached to its lease, of that property", async () => {
    const res = await POST(
      upload({
        business_domain: "property_management",
        property_id: "prop1",
        category: "חוזה/הסכם",
        lease_id: LEASE_ID,
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      document: { id: string };
      lease_attached: boolean;
    };
    expect(body.lease_attached).toBe(true);
    expect(leaseUpdates[0].row.document_id).toBe(body.document.id);
    expect(leaseUpdates[0].filters).toEqual([
      ["id", LEASE_ID],
      ["property_id", "prop1"],
    ]);
  });

  it("no such lease on that property: the file still goes up, and says it wasn't attached", async () => {
    leaseFound = false;
    const res = await POST(
      upload({
        business_domain: "property_management",
        property_id: "prop1",
        lease_id: LEASE_ID,
      }),
    );
    expect(res.status).toBe(200);
    expect(
      ((await res.json()) as { lease_attached: boolean }).lease_attached,
    ).toBe(false);
  });

  it("any other upload: as before", async () => {
    const res = await POST(
      upload({ business_domain: "property_management", property_id: "prop1" }),
    );
    expect(res.status).toBe(200);
    expect(leaseUpdates).toEqual([]);
    expect("lease_attached" in ((await res.json()) as object)).toBe(false);
  });
});

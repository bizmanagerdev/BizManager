import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// Contract tests for POST /api/payments/update — validation, the "linked
// payment must be edited from its own screen" guard, the field-preservation
// rules (payment_status/account_id must NOT silently revert on an edit that
// doesn't touch them — see the route's own comments), persistence, and the
// audit-log call. Every external dependency is mocked.

const { requireRouteAccess, logAuditEvent, syncEntityTags } = vi.hoisted(() => ({
  requireRouteAccess: vi.fn(),
  logAuditEvent: vi.fn(),
  syncEntityTags: vi.fn(),
}));

vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));
vi.mock("@/lib/audit", () => ({ logAuditEvent }));
vi.mock("@/lib/tags", () => ({ parseTagIds: () => [], syncEntityTags }));
vi.mock("@/lib/settings/vat", () => ({ getCurrentVatRate: async () => 0.18 }));

import { POST } from "@/app/api/payments/update/route";

type Resp = { data: unknown; error: unknown };
type TableConfig = Resp | { read?: Resp; write?: Resp };

/** Each `.from(table)` call gets its own builder: the route reads the
 *  existing row first (`read`), then separately calls `.update(values)` on a
 *  fresh `.from("payments")` chain (`write`) — modeling that lets a test give
 *  the read and the write different mocked outcomes (e.g. the update fails).
 *  Every `.update(values)` call is recorded so a test can assert on what was
 *  actually about to be persisted, not just the mocked return. */
function makeSupabase(config: Record<string, TableConfig>) {
  const updateCalls: Record<string, unknown[]> = {};
  const from = (table: string) => {
    const cfg = (config[table] ?? { data: null, error: null }) as TableConfig;
    const isSplit = cfg !== null && typeof cfg === "object" && ("read" in cfg || "write" in cfg);
    const readResp: Resp = isSplit ? ((cfg as { read?: Resp }).read ?? { data: null, error: null }) : (cfg as Resp);
    const writeResp: Resp = isSplit ? ((cfg as { write?: Resp }).write ?? readResp) : readResp;
    let resp = readResp;
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "eq", "not", "gte", "in", "order", "limit"]) {
      builder[m] = () => builder;
    }
    builder.update = (values: unknown) => {
      (updateCalls[table] ??= []).push(values);
      resp = writeResp;
      return builder;
    };
    builder.maybeSingle = () => Promise.resolve(resp);
    builder.then = (onF: (v: Resp) => unknown, onR?: (e: unknown) => unknown) => Promise.resolve(resp).then(onF, onR);
    return builder;
  };
  return { from, updateCalls };
}

function grant(supabase: unknown) {
  requireRouteAccess.mockResolvedValue({
    ok: true,
    value: { supabase, user: { id: "auth-1" }, profile: { id: "prof-1", role: "admin" } },
  });
}

function post(body: unknown) {
  return POST(new Request("http://test/api/payments/update", { method: "POST", body: JSON.stringify(body) }));
}

const EXISTING = {
  id: "pay-1",
  project_id: null,
  order_id: null,
  property_id: null,
  business_domain: "sales",
  payment_status: "cleared",
  vat_rate: 0.17,
  account_id: "acc-existing",
};

const VALID = {
  id: "pay-1",
  amount_total: 1000,
  payment_date: "2026-05-01",
  payment_method: "bank_transfer",
};

beforeEach(() => {
  requireRouteAccess.mockReset();
  logAuditEvent.mockReset();
  syncEntityTags.mockReset();
});

describe("POST /api/payments/update — auth gate", () => {
  it("returns the gate's response and never touches the DB when access is denied", async () => {
    requireRouteAccess.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    });
    const res = await post(VALID);
    expect(res.status).toBe(403);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});

describe("POST /api/payments/update — validation", () => {
  it("400 on missing id", async () => {
    const res = await post({ ...VALID, id: undefined });
    expect(res.status).toBe(400);
  });

  it("400 on missing/invalid amount", async () => {
    const res = await post({ ...VALID, amount_total: 0 });
    expect(res.status).toBe(400);
  });

  it("400 on missing payment_date or payment_method", async () => {
    const res = await post({ ...VALID, payment_method: "" });
    expect(res.status).toBe(400);
  });

  it("400 on a check with no due_date", async () => {
    const res = await post({ ...VALID, payment_method: "check", due_date: null });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/payments/update — the linked-payment guard", () => {
  it("404 when the payment doesn't exist", async () => {
    grant(makeSupabase({ payments: { data: null, error: null } }));
    const res = await post(VALID);
    expect(res.status).toBe(404);
  });

  it("refuses to edit a project/order-linked payment with no project_id supplied", async () => {
    grant(makeSupabase({ payments: { data: { ...EXISTING, project_id: "proj-1" }, error: null } }));
    const res = await post(VALID); // no project_id in the body
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("יש לערוך אותו מהמסך המתאים");
  });

  it("404 when the supplied project_id doesn't match the payment's own", async () => {
    grant(makeSupabase({ payments: { data: { ...EXISTING, project_id: "proj-1" }, error: null } }));
    const res = await post({ ...VALID, project_id: "proj-2" });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/payments/update — field preservation", () => {
  it("preserves the existing payment_status (cleared) instead of recomputing a default", async () => {
    const sb = makeSupabase({ payments: { data: { ...EXISTING, id: "pay-1" }, error: null } });
    grant(sb);
    await post(VALID);
    expect(sb.updateCalls.payments[0]).toMatchObject({ payment_status: "cleared" });
  });

  it("preserves the existing account_id when the caller sends none", async () => {
    const sb = makeSupabase({ payments: { data: { ...EXISTING, id: "pay-1" }, error: null } });
    grant(sb);
    await post(VALID);
    expect(sb.updateCalls.payments[0]).toMatchObject({ account_id: "acc-existing" });
  });

  it("overrides account_id when the caller explicitly sends a new one", async () => {
    const sb = makeSupabase({ payments: { data: { ...EXISTING, id: "pay-1" }, error: null } });
    grant(sb);
    await post({ ...VALID, account_id: "acc-new" });
    expect(sb.updateCalls.payments[0]).toMatchObject({ account_id: "acc-new" });
  });

  it("freezes the payment's own existing VAT rate when marking it official, rather than the current global rate", async () => {
    const sb = makeSupabase({ payments: { data: { ...EXISTING, id: "pay-1" }, error: null } });
    grant(sb);
    await post({ ...VALID, requires_split: true });
    // EXISTING.vat_rate is 0.17, distinct from the mocked getCurrentVatRate (0.18).
    expect(sb.updateCalls.payments[0]).toMatchObject({ vat_rate: 0.17 });
  });
});

describe("POST /api/payments/update — persistence & audit", () => {
  it("persists, logs an 'update' audit event and syncs tags on success", async () => {
    const sb = makeSupabase({ payments: { data: { ...EXISTING, id: "pay-1" }, error: null } });
    grant(sb);
    const res = await post(VALID);
    expect(res.status).toBe(200);
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ tableName: "payments", action: "update", recordId: "pay-1", changedBy: "prof-1" })
    );
    expect(syncEntityTags).toHaveBeenCalledWith(expect.anything(), "payment", "pay-1", [], {
      replace: true,
      createdBy: "prof-1",
    });
  });
});

describe("POST /api/payments/update — Hebrew error mapping", () => {
  it("maps a DB unique-violation on the update itself to a Hebrew message", async () => {
    const sb = makeSupabase({
      payments: {
        read: { data: EXISTING, error: null },
        write: { data: null, error: { message: "duplicate key value violates unique constraint" } },
      },
    });
    grant(sb);
    const res = await post(VALID);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("הערך כבר קיים במערכת.");
  });
});

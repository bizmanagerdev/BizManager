import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeSupabase } from "@/__tests__/mocks/supabase-query-builder";

// The routes behind the customer page:
// - /api/customers/delete refuses a tenant too (the lease was missing from its
//   check, so the database's own refusal surfaced instead), names what's in the
//   way in the page's words, and answers a dry run without deleting;
// - /api/collections/activity can leave the receivables out (the panel's
//   re-read after a call or a reminder);
// - /api/payment-promises/update is back, so a promise's status can wait in
//   the send queue.

const access = vi.hoisted(() => ({ requireRouteAccess: vi.fn() }));
vi.mock("@/lib/auth/requireRouteAccess", () => access);
vi.mock("@/lib/audit-after", () => ({ logAuditEventAfterResponse: vi.fn() }));
const libs = vi.hoisted(() => ({
  getCustomerActivity: vi.fn(async () => ({ logs: [{ id: "l1" }], reminders: [] })),
  getCustomerReceivables: vi.fn(async () => [{ source_id: "o1" }]),
}));
vi.mock("@/lib/communications", () => ({ getCustomerActivity: libs.getCustomerActivity }));
vi.mock("@/lib/collections", () => ({ getCustomerReceivables: libs.getCustomerReceivables }));

import { POST as deleteCustomer } from "@/app/api/customers/delete/route";
import { GET as collectionActivity } from "@/app/api/collections/activity/route";
import { POST as updatePromise } from "@/app/api/payment-promises/update/route";

function post(body: unknown) {
  return new Request("https://biz-h.test/api", { method: "POST", body: JSON.stringify(body) });
}

function counted(count: number) {
  return { data: null, error: null, count };
}

/** makeSupabase with head-count answers per table. */
function deleteDb(counts: { orders?: number; projects?: number; leases?: number; morning?: number }) {
  const sb = makeSupabase({
    customers: { read: { data: { id: "c1", name: "אלון" }, error: null }, write: { data: [{ id: "c1" }], error: null } },
    orders: counted(counts.orders ?? 0) as never,
    projects: counted(counts.projects ?? 0) as never,
    lease_agreements: counted(counts.leases ?? 0) as never,
    morning_documents: counted(counts.morning ?? 0) as never,
    contacts: { data: null, error: null },
  });
  return sb;
}

beforeEach(() => {
  access.requireRouteAccess.mockReset();
  libs.getCustomerActivity.mockClear();
  libs.getCustomerReceivables.mockClear();
});

describe("POST /api/customers/delete", () => {
  it("refuses a tenant's delete, saying so the way the page does", async () => {
    const sb = deleteDb({ leases: 1 });
    access.requireRouteAccess.mockResolvedValue({ ok: true, value: { supabase: sb, profile: { id: "u1", role: "admin" } } });
    const response = await deleteCustomer(post({ id: "c1" }));
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.blocker).toBe("יש ללקוח חוזה שכירות אחד");
    expect(json.error).toBe("לא ניתן למחוק את הלקוח: יש ללקוח חוזה שכירות אחד. אפשר לסמן אותו כלא פעיל.");
    expect(sb.calls.delete.customers).toBeUndefined();
  });

  it("a dry run says what's in the way and deletes nothing", async () => {
    const sb = deleteDb({ orders: 6, projects: 2 });
    access.requireRouteAccess.mockResolvedValue({ ok: true, value: { supabase: sb, profile: { id: "u1", role: "admin" } } });
    const response = await deleteCustomer(post({ id: "c1", dry_run: true }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, blocker: "יש ללקוח 6 הזמנות ו-2 פרויקטים" });
    expect(sb.calls.delete.customers).toBeUndefined();
    expect(sb.calls.delete.contacts).toBeUndefined();
  });

  it("a dry run of a free customer says nothing is in the way", async () => {
    const sb = deleteDb({});
    access.requireRouteAccess.mockResolvedValue({ ok: true, value: { supabase: sb, profile: { id: "u1", role: "admin" } } });
    expect(await (await deleteCustomer(post({ id: "c1", dry_run: true }))).json()).toEqual({ ok: true, blocker: null });
  });

  it("needs an id, and a customer that's there", async () => {
    expect((await deleteCustomer(post({}))).status).toBe(400);
    const sb = makeSupabase({ customers: { data: null, error: null } });
    access.requireRouteAccess.mockResolvedValue({ ok: true, value: { supabase: sb, profile: { id: "u1", role: "admin" } } });
    expect((await deleteCustomer(post({ id: "gone" }))).status).toBe(404);
  });

  it("says when the database refused, without claiming success", async () => {
    const refusedRead = makeSupabase({ customers: { data: null, error: { code: "42501", message: "permission denied" } } });
    access.requireRouteAccess.mockResolvedValue({ ok: true, value: { supabase: refusedRead, profile: { id: "u1", role: "admin" } } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await deleteCustomer(post({ id: "c1" }))).status).toBe(400);

    // RLS lets the read through but removes nothing.
    const noRows = makeSupabase({
      customers: { read: { data: { id: "c1", name: "אלון" }, error: null }, write: { data: [], error: null } },
      orders: counted(0) as never,
      projects: counted(0) as never,
      lease_agreements: counted(0) as never,
      morning_documents: counted(0) as never,
    });
    access.requireRouteAccess.mockResolvedValue({ ok: true, value: { supabase: noRows, profile: { id: "u1", role: "admin" } } });
    const response = await deleteCustomer(post({ id: "c1" }));
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("מחיקת הלקוח נחסמה (אין הרשאה למחוק לקוח זה).");
  });

  it("a foreign key the check missed still comes back in words", async () => {
    const sb = makeSupabase({
      customers: { read: { data: { id: "c1", name: "אלון" }, error: null }, write: { data: null, error: { code: "23503", message: "" } } },
      orders: counted(0) as never,
      projects: counted(0) as never,
      lease_agreements: counted(0) as never,
      morning_documents: counted(0) as never,
    });
    access.requireRouteAccess.mockResolvedValue({ ok: true, value: { supabase: sb, profile: { id: "u1", role: "admin" } } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await deleteCustomer(post({ id: "c1" }));
    expect((await response.json()).error).toMatch(/^לא ניתן למחוק את הלקוח/);
  });

  it("deletes a customer with nothing linked", async () => {
    const sb = deleteDb({});
    access.requireRouteAccess.mockResolvedValue({ ok: true, value: { supabase: sb, profile: { id: "u1", role: "admin" } } });
    const response = await deleteCustomer(post({ id: "c1" }));
    expect(await response.json()).toEqual({ ok: true });
    expect(sb.calls.delete.customers).toBe(1);
  });
});

describe("GET /api/collections/activity", () => {
  it("answers with the receivables by default", async () => {
    access.requireRouteAccess.mockResolvedValue({ ok: true, value: { supabase: {} } });
    const json = await (await collectionActivity(new Request("https://biz-h.test/api/collections/activity?customer_id=c1"))).json();
    expect(json).toEqual({ logs: [{ id: "l1" }], reminders: [], receivables: [{ source_id: "o1" }] });
  });

  it("leaves the receivables out when asked — they're the heavy part", async () => {
    access.requireRouteAccess.mockResolvedValue({ ok: true, value: { supabase: {} } });
    const json = await (
      await collectionActivity(new Request("https://biz-h.test/api/collections/activity?customer_id=c1&receivables=0"))
    ).json();
    expect(json).toEqual({ logs: [{ id: "l1" }], reminders: [] });
    expect(libs.getCustomerReceivables).not.toHaveBeenCalled();
  });

  it("asks for the customer in Hebrew", async () => {
    const response = await collectionActivity(new Request("https://biz-h.test/api/collections/activity"));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("חסר מזהה לקוח.");
  });
});

describe("POST /api/payment-promises/update", () => {
  it("writes the new status with who changed it", async () => {
    const sb = makeSupabase({ payment_promises: { data: [{ id: "pp1" }], error: null } });
    access.requireRouteAccess.mockResolvedValue({ ok: true, value: { supabase: sb, profile: { id: "u1" } } });
    const response = await updatePromise(post({ id: "pp1", status: "kept", amount: "250", notes: "  " }));
    expect(await response.json()).toEqual({ ok: true });
    expect(sb.calls.update.payment_promises![0]).toMatchObject({ status: "kept", amount: 250, notes: null, updated_by: "u1" });
  });

  it("ignores a status it doesn't know", async () => {
    const sb = makeSupabase({ payment_promises: { data: [{ id: "pp1" }], error: null } });
    access.requireRouteAccess.mockResolvedValue({ ok: true, value: { supabase: sb, profile: { id: "u1" } } });
    await updatePromise(post({ id: "pp1", status: "paid" }));
    expect(sb.calls.update.payment_promises![0]).not.toHaveProperty("status");
  });

  it("says when the promise isn't there (or can't be changed)", async () => {
    const sb = makeSupabase({ payment_promises: { data: [], error: null } });
    access.requireRouteAccess.mockResolvedValue({ ok: true, value: { supabase: sb, profile: { id: "u1" } } });
    const response = await updatePromise(post({ id: "pp1", status: "kept" }));
    expect(response.status).toBe(404);
  });

  it("needs an id", async () => {
    const response = await updatePromise(post({ status: "kept" }));
    expect(response.status).toBe(400);
    expect(access.requireRouteAccess).not.toHaveBeenCalled();
  });

  it("is for admin and office", async () => {
    access.requireRouteAccess.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    expect((await updatePromise(post({ id: "pp1", status: "kept" }))).status).toBe(403);
    expect(access.requireRouteAccess).toHaveBeenCalledWith({ allowedRoles: ["admin", "office"] });
  });
});

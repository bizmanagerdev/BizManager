import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeSupabase } from "@/__tests__/mocks/supabase-query-builder";

// Contract tests for POST /api/payroll/workers/delete (turning a worker off).
// The invariant: their LOGIN ends too, not just the profile — the auth user is
// banned, and banned BEFORE the profile write, so a failed ban leaves the
// worker exactly as they were instead of half turned off.

const { requireRouteAccess, updateUserById } = vi.hoisted(() => ({
  requireRouteAccess: vi.fn(),
  updateUserById: vi.fn(),
}));

vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ auth: { admin: { updateUserById } } }),
}));

import { POST } from "@/app/api/payroll/workers/delete/route";

const WORKER = {
  id: "u1",
  auth_user_id: "auth-1",
  full_name: "עובד",
  email: "w@bizh.test",
  phone: null,
  role: "worker",
  payroll_worker_type: "hourly_payslip",
  pay_tracking_mode: "session",
};

let order: string[];

function grant(worker: unknown = WORKER) {
  const rpc = vi.fn(async (name: string) => {
    order.push(`rpc:${name}`);
    return { data: "u1", error: null };
  });
  const supabase = { ...makeSupabase({ users: { data: worker, error: null } }), rpc };
  requireRouteAccess.mockResolvedValue({ ok: true, value: { supabase } });
  return rpc;
}

function post(body: unknown) {
  return POST(new Request("http://test/api/payroll/workers/delete", { method: "POST", body: JSON.stringify(body) }));
}

beforeEach(() => {
  order = [];
  requireRouteAccess.mockReset();
  updateUserById.mockReset();
  updateUserById.mockImplementation(async (_id: string, attrs: { ban_duration: string }) => {
    order.push(`ban:${attrs.ban_duration}`);
    return { data: {}, error: null };
  });
});

describe("POST /api/payroll/workers/delete — the login ends with the profile", () => {
  it("bans the auth user, then marks the profile inactive", async () => {
    const rpc = grant();
    const res = await post({ user_id: "u1" });

    expect(res.status).toBe(200);
    expect(updateUserById).toHaveBeenCalledWith("auth-1", { ban_duration: "876000h" });
    expect(order).toEqual(["ban:876000h", "rpc:admin_upsert_user_profile"]);
    expect(rpc).toHaveBeenCalledWith(
      "admin_upsert_user_profile",
      expect.objectContaining({ p_active: false, p_system_access: false })
    );
  });

  it("leaves the profile untouched when the ban fails", async () => {
    const rpc = grant();
    updateUserById.mockResolvedValueOnce({ data: null, error: { message: "User not found" } });

    const res = await post({ user_id: "u1" });

    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("skips the ban for a worker who never had a login", async () => {
    const rpc = grant({ ...WORKER, auth_user_id: null });
    const res = await post({ user_id: "u1" });

    expect(res.status).toBe(200);
    expect(updateUserById).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeSupabase } from "@/__tests__/mocks/supabase-query-builder";

// Contract tests for POST /api/payroll/workers/update — the login-access half.
// Whatever the admin sets, the auth user has to follow it both ways: turning
// access off bans the login, turning it back on lifts the ban. Always before
// the profile write, so a failed ban/unban changes nothing.

const { requireRouteAccess, updateUserById } = vi.hoisted(() => ({
  requireRouteAccess: vi.fn(),
  updateUserById: vi.fn(),
}));

vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ auth: { admin: { updateUserById } } }),
}));

import { POST } from "@/app/api/payroll/workers/update/route";

const EXISTING = { id: "u1", auth_user_id: "auth-1", email: "w@bizh.test" };
const BASE = { user_id: "u1", full_name: "עובד", email: "w@bizh.test", role: "worker", active: true, system_access: true };

let order: string[];

function grant(existing: unknown = EXISTING) {
  const rpc = vi.fn(async (name: string) => {
    order.push(`rpc:${name}`);
    return { data: "u1", error: null };
  });
  const supabase = { ...makeSupabase({ users: { data: existing, error: null } }), rpc };
  requireRouteAccess.mockResolvedValue({ ok: true, value: { supabase } });
  return rpc;
}

function post(body: unknown) {
  return POST(new Request("http://test/api/payroll/workers/update", { method: "POST", body: JSON.stringify(body) }));
}

beforeEach(() => {
  order = [];
  requireRouteAccess.mockReset();
  updateUserById.mockReset();
  updateUserById.mockImplementation(async (_id: string, attrs: { ban_duration?: string }) => {
    order.push(`ban:${attrs.ban_duration}`);
    return { data: {}, error: null };
  });
});

describe("POST /api/payroll/workers/update — the login follows the profile", () => {
  it("turning a worker off bans their login before the profile write", async () => {
    grant();
    const res = await post({ ...BASE, active: false });

    expect(res.status).toBe(200);
    expect(order).toEqual(["ban:876000h", "rpc:admin_upsert_user_profile"]);
  });

  it("removing system access bans the login too", async () => {
    grant();
    await post({ ...BASE, system_access: false });
    expect(updateUserById).toHaveBeenCalledWith("auth-1", { ban_duration: "876000h" });
  });

  it("worker_no_access bans the login", async () => {
    grant();
    await post({ ...BASE, role: "worker_no_access" });
    expect(updateUserById).toHaveBeenCalledWith("auth-1", { ban_duration: "876000h" });
  });

  it("turning a worker back on lifts the ban", async () => {
    grant();
    const res = await post(BASE);

    expect(res.status).toBe(200);
    expect(order).toEqual(["ban:none", "rpc:admin_upsert_user_profile"]);
  });

  it("a failed ban changes nothing", async () => {
    const rpc = grant();
    updateUserById.mockResolvedValueOnce({ data: null, error: { message: "User not found" } });

    const res = await post({ ...BASE, active: false });

    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a worker with no login and no access is saved without touching auth", async () => {
    const rpc = grant({ ...EXISTING, auth_user_id: null });
    const res = await post({ ...BASE, role: "worker_no_access", email: "" });

    expect(res.status).toBe(200);
    expect(updateUserById).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

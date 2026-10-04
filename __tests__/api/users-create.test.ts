import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeSupabase } from "@/__tests__/mocks/supabase-query-builder";

// Contract tests for POST /api/users/create — the login-access half. An account
// created with system access but switched off starts with its login banned,
// the same state turning it off later would leave it in (lib/auth/loginAccess.ts).

const { requireRouteAccess, createUser } = vi.hoisted(() => ({
  requireRouteAccess: vi.fn(),
  createUser: vi.fn(),
}));

vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ auth: { admin: { createUser } } }),
}));

import { POST } from "@/app/api/users/create/route";

const CREATED = { id: "u-new", auth_user_id: "auth-new", full_name: "חדש", email: "new@bizh.test", role: "worker" };
const BODY = { full_name: "חדש", email: "new@bizh.test", password: "secret1", role: "worker", system_access: true };

function grant() {
  // The first users read is the "does this email already exist?" check — it
  // must come back empty, or the route returns the existing user early.
  let usersReads = 0;
  const supabase = {
    from: (table: string) =>
      makeSupabase({ users: { data: usersReads++ === 0 ? null : CREATED, error: null } }).from(table),
    rpc: vi.fn(async () => ({ data: "u-new", error: null })),
  };
  requireRouteAccess.mockResolvedValue({ ok: true, value: { supabase } });
}

function post(body: unknown) {
  return POST(new Request("http://test/api/users/create", { method: "POST", body: JSON.stringify(body) }));
}

beforeEach(() => {
  requireRouteAccess.mockReset();
  createUser.mockReset();
  createUser.mockResolvedValue({ data: { user: { id: "auth-new" } }, error: null });
});

describe("POST /api/users/create — the new login matches the profile", () => {
  it("an account created switched off starts with its login banned", async () => {
    grant();
    const res = await post({ ...BODY, active: false });

    expect(res.status).toBe(200);
    expect(createUser).toHaveBeenCalledWith(expect.objectContaining({ ban_duration: "876000h" }));
  });

  it("an active account is created without a ban", async () => {
    grant();
    await post(BODY);

    expect(createUser).toHaveBeenCalledTimes(1);
    expect(createUser.mock.calls[0][0]).not.toHaveProperty("ban_duration");
  });
});

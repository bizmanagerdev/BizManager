import { describe, it, expect, vi, beforeEach } from "vitest";

// requireRouteAccess is the SINGLE authorization gate shared by all ~153 API
// routes. Testing every branch here covers the auth behaviour of the whole API
// surface in one place. We mock the Supabase route client (the only dependency)
// and drive each decision path.

const getUser = vi.fn();
const maybeSingle = vi.fn();

// Records the column/value passed to .eq() so we can assert the gate looks up
// the profile by auth_user_id (the correct identity column — a known bug class).
const eqSpy = vi.fn();

function makeSupabase() {
  return {
    auth: { getUser },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: (col: string, val: string) => {
          eqSpy(col, val);
          return { maybeSingle };
        },
      })),
    })),
  };
}

vi.mock("@/lib/supabase/route", () => ({
  createSupabaseRouteClient: vi.fn(async () => makeSupabase()),
}));

import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

const ACTIVE_ADMIN = {
  id: "profile-1",
  auth_user_id: "auth-1",
  role: "admin",
  active: true,
  system_access: true,
  email: "a@b.com",
  full_name: "Admin",
};

function authedUser() {
  getUser.mockResolvedValue({ data: { user: { id: "auth-1", email: "a@b.com" } }, error: null });
}

beforeEach(() => {
  getUser.mockReset();
  maybeSingle.mockReset();
  eqSpy.mockReset();
});

describe("requireRouteAccess — authentication", () => {
  it("returns 400 when getUser errors", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: "boom" } });
    const result = await requireRouteAccess();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(400);
  });

  it("returns 401 when there is no user (not logged in)", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const result = await requireRouteAccess();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });
});

describe("requireRouteAccess — profile lookup", () => {
  it("looks the profile up by auth_user_id, not id", async () => {
    authedUser();
    maybeSingle.mockResolvedValue({ data: ACTIVE_ADMIN, error: null });
    await requireRouteAccess();
    expect(eqSpy).toHaveBeenCalledWith("auth_user_id", "auth-1");
  });

  it("returns 403 when the profile query errors", async () => {
    authedUser();
    maybeSingle.mockResolvedValue({ data: null, error: { message: "rls" } });
    const result = await requireRouteAccess();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it("returns 403 when there is no profile row", async () => {
    authedUser();
    maybeSingle.mockResolvedValue({ data: null, error: null });
    const result = await requireRouteAccess();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });
});

describe("requireRouteAccess — account state gating", () => {
  it("rejects an inactive account (403)", async () => {
    authedUser();
    maybeSingle.mockResolvedValue({ data: { ...ACTIVE_ADMIN, active: false }, error: null });
    const result = await requireRouteAccess();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it("rejects an account without system_access (403)", async () => {
    authedUser();
    maybeSingle.mockResolvedValue({ data: { ...ACTIVE_ADMIN, system_access: false }, error: null });
    const result = await requireRouteAccess();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it("rejects the worker_no_access role (403)", async () => {
    authedUser();
    maybeSingle.mockResolvedValue({ data: { ...ACTIVE_ADMIN, role: "worker_no_access" }, error: null });
    const result = await requireRouteAccess();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });
});

describe("requireRouteAccess — role gate (allowedRoles)", () => {
  it("allows an active admin through with no role restriction", async () => {
    authedUser();
    maybeSingle.mockResolvedValue({ data: ACTIVE_ADMIN, error: null });
    const result = await requireRouteAccess();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.profile.role).toBe("admin");
      expect(result.value.user.id).toBe("auth-1");
    }
  });

  it("rejects a worker when the route is restricted to admin/office (403)", async () => {
    authedUser();
    maybeSingle.mockResolvedValue({ data: { ...ACTIVE_ADMIN, role: "worker" }, error: null });
    const result = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it("allows office when the route permits admin/office", async () => {
    authedUser();
    maybeSingle.mockResolvedValue({ data: { ...ACTIVE_ADMIN, role: "office" }, error: null });
    const result = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    expect(result.ok).toBe(true);
  });

  it("an empty allowedRoles list does not restrict by role", async () => {
    authedUser();
    maybeSingle.mockResolvedValue({ data: { ...ACTIVE_ADMIN, role: "worker" }, error: null });
    const result = await requireRouteAccess({ allowedRoles: [] });
    expect(result.ok).toBe(true);
  });
});

import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { initialBanAttributes, mayLogIn, syncLoginAccess } from "@/lib/auth/loginAccess";

describe("mayLogIn — the one rule shared by requireProfile, requireRouteAccess and the auth ban", () => {
  it("lets in only an active user with system access and a real role", () => {
    expect(mayLogIn({ active: true, systemAccess: true, role: "worker" })).toBe(true);
    expect(mayLogIn({ active: true, systemAccess: true, role: "office" })).toBe(true);
    expect(mayLogIn({ active: true, systemAccess: true, role: "admin" })).toBe(true);
  });
  it("keeps out a turned-off user, one without system access, and worker_no_access", () => {
    expect(mayLogIn({ active: false, systemAccess: true, role: "worker" })).toBe(false);
    expect(mayLogIn({ active: true, systemAccess: false, role: "worker" })).toBe(false);
    expect(mayLogIn({ active: true, systemAccess: true, role: "worker_no_access" })).toBe(false);
  });
});

function adminClient(error: { message: string } | null = null) {
  const updateUserById = vi.fn(async () => ({ data: {}, error }));
  return { client: { auth: { admin: { updateUserById } } } as unknown as SupabaseClient, updateUserById };
}

describe("syncLoginAccess", () => {
  it("bans the auth user when they may no longer log in", async () => {
    const { client, updateUserById } = adminClient();
    expect(await syncLoginAccess(client, "auth-1", false)).toBeNull();
    expect(updateUserById).toHaveBeenCalledWith("auth-1", { ban_duration: "876000h" });
  });
  it("lifts the ban when access is given back", async () => {
    const { client, updateUserById } = adminClient();
    expect(await syncLoginAccess(client, "auth-1", true)).toBeNull();
    expect(updateUserById).toHaveBeenCalledWith("auth-1", { ban_duration: "none" });
  });
  it("returns GoTrue's error message instead of throwing", async () => {
    const { client } = adminClient({ message: "User not found" });
    expect(await syncLoginAccess(client, "auth-1", false)).toBe("User not found");
  });
});

describe("initialBanAttributes", () => {
  it("adds nothing for an account created with access, a ban for one created without", () => {
    expect(initialBanAttributes(true)).toEqual({});
    expect(initialBanAttributes(false)).toEqual({ ban_duration: "876000h" });
  });
});

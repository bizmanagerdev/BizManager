import type { SupabaseClient } from "@supabase/supabase-js";

// Supabase Auth has to agree with the profile about who may log in.
//
// Turning a user off (users.active / users.system_access / role
// worker_no_access) used to change only the profile. requireProfile() then
// kept them out of the app's pages — but their Supabase session lived on: the
// refresh token kept minting new access tokens indefinitely, and a direct API
// call could still reach whatever RLS let through. Banning the auth user stops
// the renewals; the restrictive "active users only" RLS policies
// (supabase/migrations/20261004150000_inactive_users_lose_access.sql) cut off
// the access token already in their hands for the rest of its lifetime.
//
// mayLogIn() is the single rule — requireProfile() uses it too, so the page
// gate and the login gate can't drift apart.

/** GoTrue has no "forever"; ~100 years is effectively that. */
const BAN_FOREVER = "876000h";

export type LoginAccessFields = {
  active: boolean;
  systemAccess: boolean;
  role: string;
};

export function mayLogIn({ active, systemAccess, role }: LoginAccessFields): boolean {
  return active && systemAccess && role !== "worker_no_access";
}

/**
 * Bans or unbans the auth user to match `allowed`. Returns the error message,
 * or null on success. Idempotent — safe to call on every profile save, which
 * also heals any account whose ban state drifted.
 *
 * Call it BEFORE writing the profile: when turning access off, a failure then
 * leaves nothing half-done; when turning it on, unbanning first is harmless
 * because the profile (and RLS) still gate them until the write lands.
 */
export async function syncLoginAccess(
  adminClient: SupabaseClient,
  authUserId: string,
  allowed: boolean
): Promise<string | null> {
  const { error } = await adminClient.auth.admin.updateUserById(authUserId, {
    ban_duration: allowed ? "none" : BAN_FOREVER,
  });
  return error ? error.message : null;
}

/** For admin.createUser(): an account created without access starts banned. */
export function initialBanAttributes(allowed: boolean): { ban_duration?: string } {
  return allowed ? {} : { ban_duration: BAN_FOREVER };
}

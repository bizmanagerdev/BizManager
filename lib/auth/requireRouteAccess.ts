import { NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/lib/supabase/route";
import type { UserRole } from "@/lib/auth/requireProfile";

type RouteProfile = {
  id: string;
  auth_user_id?: string | null;
  role: UserRole;
  active: boolean;
  system_access: boolean;
  email: string | null;
  full_name: string | null;
  /** UI language ('he' | 'ar'); only the worker role is ever offered a toggle. */
  locale: "he" | "ar";
  /** Per-worker toggle for deliveries access; admin-set, meaningless for staff. */
  deliveries_access: boolean;
};

type RouteAccessOk = {
  supabase: Awaited<ReturnType<typeof createSupabaseRouteClient>>;
  user: { id: string; email?: string | null };
  profile: RouteProfile;
};

type RouteAccessResult =
  | { ok: true; value: RouteAccessOk }
  | { ok: false; response: NextResponse };

export async function requireRouteAccess(options?: {
  allowedRoles?: UserRole[];
}): Promise<RouteAccessResult> {
  const supabase = await createSupabaseRouteClient();

  // getSession(), NOT getUser() — see the matching notes in middleware.ts and
  // requireProfile.ts (2026-09-02). getUser() makes an HTTP round-trip to the
  // Auth server on every call, and this function gates nearly every API route
  // in the app, so every write (including every delivery-confirm request) paid
  // that latency. Under Auth-server load this produced two failure modes: a
  // false "Unauthorized" for a genuinely signed-in user (getUser() silently
  // returns {user: null} when saturated, no thrown error), and — worse — a
  // race where the round-trip's latency outlasted a token refresh, so the
  // request that finally reached Postgres carried a JWT already rotated out
  // from under it, producing a real RLS with_check failure on the write
  // ("new row violates row-level security policy") for an account whose
  // active/system_access were never actually wrong. Confirmed live 2026-09-02:
  // a worker's delivery-confirm failed twice this way, then succeeded on
  // retry seconds later — intermittent, not a data problem.
  //
  // The identity read here is not the trust boundary on its own: it only
  // decides which `users` row to load, and that row's role/active/
  // system_access checks below — plus RLS on every subsequent query, via the
  // same supabase client returned to the caller — are what actually gate
  // access. Restore verification with getClaims() (local JWKS check) if ever
  // needed, not getUser().
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user ?? null;

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  let { data: profile, error: profileError } = await supabase
    .from("users")
    .select("id,auth_user_id,role,active,system_access,email,full_name,locale,deliveries_access")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (profileError) {
    // Pre-migration: `locale`/`deliveries_access` may not exist yet. Retry
    // without them rather than locking every route out.
    const legacy = await supabase
      .from("users")
      .select("id,auth_user_id,role,active,system_access,email,full_name")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    profile = legacy.data as typeof profile;
    profileError = legacy.error;
  }

  if (profileError || !profile) {
    return {
      ok: false,
      response: NextResponse.json({ error: "No user profile access" }, { status: 403 }),
    };
  }

  const rawLocale = (profile as { locale?: unknown }).locale;
  const rawDeliveriesAccess = (profile as { deliveries_access?: unknown }).deliveries_access;
  const typed: RouteProfile = {
    ...(profile as Omit<RouteProfile, "locale" | "deliveries_access">),
    locale: rawLocale === "ar" ? "ar" : "he",
    deliveries_access: rawDeliveriesAccess !== false,
  };

  if (!typed.active || !typed.system_access || typed.role === "worker_no_access") {
    return {
      ok: false,
      response: NextResponse.json({ error: "No access" }, { status: 403 }),
    };
  }

  const allowedRoles = options?.allowedRoles;
  if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(typed.role)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Insufficient role" }, { status: 403 }),
    };
  }

  return {
    ok: true,
    value: {
      supabase,
      user: { id: user.id, email: user.email },
      profile: typed,
    },
  };
}

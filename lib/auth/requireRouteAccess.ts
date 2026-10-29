import { NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/lib/supabase/route";
import type { UserRole } from "@/lib/auth/requireProfile";
import { sanitizeSectionAccess, type SectionAccess } from "@/lib/auth/sections";
import { mayLogIn } from "@/lib/auth/loginAccess";
import { sessionUser } from "@/lib/auth/sessionUser";

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
  /** Per-worker "which sections can he reach" map; admin-set, meaningless for staff. */
  section_access: SectionAccess;
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
  // The id is the login token's, not the cookie's editable copy of the user:
  // a copy naming someone else is refused (lib/auth/sessionUser.ts, audit
  // 2026-10-27). The token's signature is checked by the database on the
  // profile read below, made with that same token; then that row's role/
  // active/system_access checks — plus RLS on every later query, via the same
  // supabase client returned to the caller — gate access. Not getClaims()
  // either (owner, 2026-10-29).
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = sessionUser(session);

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  let { data: profile, error: profileError } = await supabase
    .from("users")
    .select("id,auth_user_id,role,active,system_access,email,full_name,locale,section_access")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (profileError) {
    // Pre-migration: `locale`/`section_access` may not exist yet. Retry
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
  const rawSectionAccess = (profile as { section_access?: unknown }).section_access;
  const typed: RouteProfile = {
    ...(profile as Omit<RouteProfile, "locale" | "section_access">),
    locale: rawLocale === "ar" ? "ar" : "he",
    section_access: sanitizeSectionAccess(rawSectionAccess),
  };

  if (!mayLogIn({ active: typed.active, systemAccess: typed.system_access, role: typed.role })) {
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

import { cache } from "react";
import { redirect } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isPayrollWorkerType, type PayrollWorkerType } from "@/lib/payroll-worker-type";

export type UserRole = "admin" | "office" | "worker" | "worker_no_access";

export type UserProfile = {
  id: string;
  auth_user_id?: string | null;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  role: UserRole;
  active: boolean;
  system_access: boolean;
  payroll_worker_type: PayrollWorkerType | null;
  // Carried on the profile so pages that need them don't fire a second `users`
  // round-trip: dashboard layout prefs (raw jsonb — sanitize before use), the
  // "what you missed" digest anchor, and the top-bar avatar's persisted color.
  dashboard_prefs?: unknown;
  digest_seen_at?: string | null;
  avatar_color: string | null;
  // UI language ('he' | 'ar'). Only the worker role is ever offered a toggle for
  // this; office/admin always stay 'he'. See lib/i18n.
  locale: "he" | "ar";
  // Per-worker toggle for /deliveries + the dashboard deliveries widget,
  // admin-set from the Salary Center worker-edit dialog. Meaningless for
  // office/admin (they always have full access regardless of this value).
  deliveries_access: boolean;
};

export const requireProfile = cache(async () => {
  const supabase = await createSupabaseServerClient();

  // getUser() (not getSession()) is required here: this result gates role/
  // access lookups below, and getSession() only reads the cookie's claims
  // back without verifying them against the Auth server — a stale or
  // tampered cookie would be trusted as-is.
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) redirect("/login");

  const userId = authUser.id;

  let { data: profile, error } = await supabase
    .from("users")
    .select(
      "id,auth_user_id,email,full_name,phone,role,active,system_access,payroll_worker_type,dashboard_prefs,digest_seen_at,locale,deliveries_access,avatar_color"
    )
    .eq("auth_user_id", userId)
    .maybeSingle();

  if (error) {
    // Pre-migration: `locale`/`deliveries_access`/`avatar_color` may not exist
    // yet. Retry without them rather than sending every signed-in user to /login.
    const legacy = await supabase
      .from("users")
      .select("id,auth_user_id,email,full_name,phone,role,active,system_access,payroll_worker_type,dashboard_prefs,digest_seen_at")
      .eq("auth_user_id", userId)
      .maybeSingle();
    profile = legacy.data as typeof profile;
    error = legacy.error;
  }

  if (error) {
    // If the session is invalid/expired, Supabase/DB calls will fail.
    redirect("/login");
  }

  if (!profile) redirect("/no-access");

  const rawWorkerType = (profile as { payroll_worker_type?: unknown }).payroll_worker_type;
  const rawLocale = (profile as { locale?: unknown }).locale;
  const rawDeliveriesAccess = (profile as { deliveries_access?: unknown }).deliveries_access;
  const rawAvatarColor = (profile as { avatar_color?: unknown }).avatar_color;
  const typed: UserProfile = {
    ...(profile as Omit<UserProfile, "payroll_worker_type" | "locale" | "deliveries_access" | "avatar_color">),
    payroll_worker_type: isPayrollWorkerType(rawWorkerType) ? rawWorkerType : null,
    locale: rawLocale === "ar" ? "ar" : "he",
    deliveries_access: rawDeliveriesAccess !== false,
    avatar_color: typeof rawAvatarColor === "string" ? rawAvatarColor : null,
  };
  if (!typed.active || !typed.system_access || typed.role === "worker_no_access") {
    redirect("/no-access");
  }

  // Attribute server-side errors to this user. The Sentry Node SDK keeps an
  // isolation scope per request, so this does not leak across concurrent
  // requests. Client-side events are tagged by components/observability/SentryUser.
  Sentry.setUser({
    id: typed.id,
    email: typed.email ?? undefined,
    username: typed.full_name ?? undefined,
  });
  Sentry.setTag("user.role", typed.role);

  return { supabase, user: authUser, profile: typed };
});

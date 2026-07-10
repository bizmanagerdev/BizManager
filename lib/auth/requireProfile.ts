import { cache } from "react";
import { redirect } from "next/navigation";
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
  // round-trip: dashboard layout prefs (raw jsonb — sanitize before use) and the
  // "what you missed" digest anchor.
  dashboard_prefs?: unknown;
  digest_seen_at?: string | null;
};

export const requireProfile = cache(async () => {
  const supabase = await createSupabaseServerClient();

  const {
    data: { session: fastSession },
  } = await supabase.auth.getSession();

  const userId = fastSession?.user?.id;

  if (!userId) redirect("/login");

  const { data: profile, error } = await supabase
    .from("users")
    .select("id,auth_user_id,email,full_name,phone,role,active,system_access,payroll_worker_type,dashboard_prefs,digest_seen_at")
    .eq("auth_user_id", userId)
    .maybeSingle();

  if (error) {
    // If the session is invalid/expired, Supabase/DB calls will fail.
    redirect("/login");
  }

  if (!profile) redirect("/no-access");

  const rawWorkerType = (profile as { payroll_worker_type?: unknown }).payroll_worker_type;
  const typed: UserProfile = {
    ...(profile as Omit<UserProfile, "payroll_worker_type">),
    payroll_worker_type: isPayrollWorkerType(rawWorkerType) ? rawWorkerType : null,
  };
  if (!typed.active || !typed.system_access || typed.role === "worker_no_access") {
    redirect("/no-access");
  }

  return { supabase, user: fastSession.user, profile: typed };
});

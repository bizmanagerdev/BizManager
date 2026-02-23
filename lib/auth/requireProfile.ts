import { cache } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type UserRole = "admin" | "office" | "worker" | "worker_no_access";

export type UserProfile = {
  id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  role: UserRole;
  active: boolean;
  system_access: boolean;
};

export const requireProfile = cache(async () => {
  const supabase = await createSupabaseServerClient();

  const {
    data: { session: fastSession },
  } = await supabase.auth.getSession();

  const activeSession = fastSession;
  const userId = fastSession?.user?.id;

  if (!userId) redirect("/login");

  const { data: profile, error } = await supabase
    .from("users")
    .select("id,email,full_name,phone,role,active,system_access")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    // If the session is invalid/expired, Supabase/DB calls will fail.
    redirect("/login");
  }

  if (!profile) redirect("/no-access");

  const typed = profile as UserProfile;
  if (!typed.active || !typed.system_access || typed.role === "worker_no_access") {
    redirect("/no-access");
  }

  return { supabase, user: fastSession.user, profile: typed };
});

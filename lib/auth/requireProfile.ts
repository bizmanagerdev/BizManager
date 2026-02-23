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

export async function requireProfile() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile, error } = await supabase
    .from("users")
    .select("id,email,full_name,phone,role,active,system_access")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !profile) redirect("/no-access");

  const typed = profile as UserProfile;
  if (!typed.active || !typed.system_access || typed.role === "worker_no_access") {
    redirect("/no-access");
  }

  return { supabase, user, profile: typed };
}


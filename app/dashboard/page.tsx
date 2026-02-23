import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type UserRole = "admin" | "office" | "worker" | "worker_no_access";

type UserProfile = {
  id: string;
  email: string | null;
  role: UserRole;
  active: boolean;
  system_access: boolean;
};

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("users")
    .select("id,email,role,active,system_access")
    .eq("id", user.id)
    .maybeSingle();

  if (
    !profile ||
    !profile.active ||
    !profile.system_access ||
    profile.role === "worker_no_access"
  ) {
    redirect("/no-access");
  }

  const typed = profile as UserProfile;

  return (
    <div style={{ padding: 24 }}>
      <h1>Dashboard</h1>
      <p>Logged in as: {typed.email}</p>
      <p>Role: {typed.role}</p>

      <form action="/api/auth/logout" method="post">
        <button type="submit" style={{ marginTop: 12 }}>
          Logout
        </button>
      </form>
    </div>
  );
}

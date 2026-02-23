import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return (
    <div style={{ padding: 24 }}>
      <h1>Dashboard</h1>
      <p>Logged in as: {user.email}</p>
    </div>
  );
}
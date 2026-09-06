import { notFound, redirect } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import { PageStack } from "@/components/layout/page-layout";
import { fetchVehicle, fetchVehicleActivity } from "@/lib/vehicles";
import { propertyDisplayName } from "@/lib/properties";
import type { UserOption } from "@/components/tasks/TaskUpsertDialog";
import VehicleActivityClient from "./VehicleActivityClient";
import VehicleHeaderCard from "./VehicleHeaderCard";

export const revalidate = 30;

export default async function VehicleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { profile, supabase } = await requireProfile();
  if (profile.role !== "admin" && profile.role !== "office") {
    redirect("/no-access");
  }

  const vehicle = await fetchVehicle(supabase, id);
  if (!vehicle) notFound();

  const [activity, usersResult, projectsResult, ordersResult, propertiesResult] = await Promise.all([
    fetchVehicleActivity(supabase, id),
    supabase
      .from("users")
      .select("id,full_name,email,avatar_color,active")
      .eq("active", true)
      // Task pickers only offer workers with system access (no payroll-only workers).
      .neq("role", "worker_no_access")
      .order("full_name", { ascending: true }),
    supabase.from("project_dashboard_view").select("id,name").order("name", { ascending: true }).range(0, 999),
    supabase
      .from("order_overview_view")
      .select("order_id,customer_name,order_date")
      .order("order_date", { ascending: false })
      .range(0, 499),
    supabase.from("properties").select("id,name,address").order("address", { ascending: true }).range(0, 999),
  ]);

  const users: UserOption[] = ((usersResult.data ?? []) as Array<Record<string, unknown>>).map((u) => ({
    id: String(u.id ?? ""),
    label: (typeof u.full_name === "string" && u.full_name) || (typeof u.email === "string" ? u.email : "") || "משתמש",
    color: typeof u.avatar_color === "string" ? u.avatar_color : null,
  }));

  type Opt = { id: string; label: string };
  const projects: Opt[] = ((projectsResult.data ?? []) as Array<Record<string, unknown>>)
    .map((p) => ({ id: String(p.id ?? ""), label: (typeof p.name === "string" && p.name) || "פרויקט" }))
    .filter((p) => p.id);
  const orders: Opt[] = ((ordersResult.data ?? []) as Array<Record<string, unknown>>)
    .map((o) => ({
      id: String(o.order_id ?? ""),
      label: `${typeof o.customer_name === "string" && o.customer_name ? `${o.customer_name} · ` : ""}#${String(o.order_id ?? "").slice(0, 8)}`,
    }))
    .filter((o) => o.id);
  const properties: Opt[] = ((propertiesResult.data ?? []) as Array<Record<string, unknown>>)
    .map((p) => ({
      id: String(p.id ?? ""),
      label:
        propertyDisplayName({
          name: typeof p.name === "string" ? p.name : null,
          address: typeof p.address === "string" ? p.address : "",
        }) || "נכס",
    }))
    .filter((p) => p.id);

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <PageStack>
        <VehicleHeaderCard vehicle={vehicle} />

        <VehicleActivityClient
          tagId={id}
          vehicleName={vehicle.name}
          activity={activity}
          users={users}
          projects={projects}
          orders={orders}
          properties={properties}
          currentUserId={profile.id}
        />
      </PageStack>
    </AppShell>
  );
}

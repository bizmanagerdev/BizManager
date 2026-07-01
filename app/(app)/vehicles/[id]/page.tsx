import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowRight, Car, ListTodo, TrendingDown, TrendingUp } from "lucide-react";
import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageStack } from "@/components/layout/page-layout";
import { formatCurrency } from "@/lib/payroll";
import { expiryStatus, fetchVehicle, fetchVehicleActivity } from "@/lib/vehicles";
import type { UserOption } from "@/components/tasks/TaskUpsertDialog";
import VehicleActivityClient from "./VehicleActivityClient";

export const revalidate = 30;

function ExpiryBadge({ label, date }: { label: string; date: string | null }) {
  const status = expiryStatus(date);
  return (
    <div className="flex items-center gap-2 rounded-md border bg-muted/20 px-3 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {date ? (
        <>
          <span className="font-medium">{date}</span>
          {status ? <Badge variant={status.tone}>{status.label}</Badge> : null}
        </>
      ) : (
        <span className="text-muted-foreground">לא הוגדר</span>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: string;
  tone?: "income" | "expense" | "neutral";
  icon?: React.ReactNode;
}) {
  const color =
    tone === "income" ? "text-emerald-600" : tone === "expense" ? "text-destructive" : "";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          {icon}
          {label}
        </div>
        <div className={`mt-1 text-xl font-semibold ${color}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

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
    supabase.from("properties").select("id,address").order("address", { ascending: true }).range(0, 999),
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
    .map((p) => ({ id: String(p.id ?? ""), label: (typeof p.address === "string" && p.address) || "נכס" }))
    .filter((p) => p.id);

  const net = activity.rollup.totalIncomeAmount - activity.rollup.paidExpenseAmount;

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <PageStack>
        <Link
          href="/vehicles"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
        >
          <ArrowRight className="h-4 w-4" />
          חזרה לרכבים
        </Link>

        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Car className="h-6 w-6" />
            {vehicle.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            {[vehicle.makeModel, vehicle.licensePlate, vehicle.year].filter(Boolean).join(" · ") || "—"}
          </p>
          {vehicle.ownerName ? (
            <p className="text-sm text-muted-foreground">רשום על שם: {vehicle.ownerName}</p>
          ) : null}
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <ExpiryBadge label="טסט" date={vehicle.testDueDate} />
          <ExpiryBadge label="ביטוח" date={vehicle.insuranceDueDate} />
          <ExpiryBadge label="רישוי" date={vehicle.licenseDueDate} />
        </div>

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <StatCard
            label="הוצאות ששולמו"
            value={formatCurrency(activity.rollup.paidExpenseAmount)}
            tone="expense"
            icon={<TrendingDown className="h-3.5 w-3.5" />}
          />
          <StatCard
            label="הכנסות"
            value={formatCurrency(activity.rollup.totalIncomeAmount)}
            tone="income"
            icon={<TrendingUp className="h-3.5 w-3.5" />}
          />
          <StatCard label="נטו" value={formatCurrency(net)} tone={net >= 0 ? "income" : "expense"} />
          <StatCard
            label="משימות פתוחות"
            value={`${activity.rollup.openTaskCount}/${activity.rollup.taskCount}`}
            icon={<ListTodo className="h-3.5 w-3.5" />}
          />
        </div>

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

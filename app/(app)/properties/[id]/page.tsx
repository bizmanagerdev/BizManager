import { notFound } from "next/navigation";
import { BuildingIcon, TrendDownIcon, TrendUpIcon } from "@/components/ui/icons";
import AppShell from "@/components/layout/AppShell";
import { requireStaffPage } from "@/lib/auth/roleAccess";
import { Card, CardContent } from "@/components/ui/card";
import { PageStack } from "@/components/layout/page-layout";
import { formatCurrency } from "@/lib/payroll";
import { fetchProperty, fetchPropertyActivity, propertyDisplayName } from "@/lib/properties";
import type { UserOption } from "@/components/tasks/TaskUpsertDialog";
import PropertyDetailClient from "./PropertyDetailClient";

export const revalidate = 30;

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
  const color = tone === "income" ? "text-emerald-600" : tone === "expense" ? "text-destructive" : "";
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

export default async function PropertyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { profile, supabase } = await requireStaffPage();

  const property = await fetchProperty(supabase, id);
  if (!property) notFound();

  const [activity, usersResult] = await Promise.all([
    fetchPropertyActivity(supabase, id),
    supabase
      .from("users")
      .select("id,full_name,email,avatar_color,active")
      .eq("active", true)
      .neq("role", "worker_no_access")
      .order("full_name", { ascending: true }),
  ]);
  const net = activity.rollup.totalIncomeAmount - activity.rollup.paidExpenseAmount;

  const users: UserOption[] = ((usersResult.data ?? []) as Array<Record<string, unknown>>).map((u) => ({
    id: String(u.id ?? ""),
    label: (typeof u.full_name === "string" && u.full_name) || (typeof u.email === "string" ? u.email : "") || "משתמש",
    color: typeof u.avatar_color === "string" ? u.avatar_color : null,
  }));

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <PageStack>
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <BuildingIcon className="h-6 w-6" />
            {propertyDisplayName(property)}
          </h1>
          {property.name ? <p className="text-sm text-muted-foreground">{property.address}</p> : null}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatCard
            label="הוצאות ששולמו"
            value={formatCurrency(activity.rollup.paidExpenseAmount)}
            tone="expense"
            icon={<TrendDownIcon className="h-3.5 w-3.5" />}
          />
          <StatCard
            label="הכנסות שנגבו (שכירות וכו')"
            value={formatCurrency(activity.rollup.totalIncomeAmount)}
            tone="income"
            icon={<TrendUpIcon className="h-3.5 w-3.5" />}
          />
          <StatCard label="נטו" value={formatCurrency(net)} tone={net >= 0 ? "income" : "expense"} />
        </div>

        <PropertyDetailClient
          propertyId={id}
          property={property}
          activity={activity}
          users={users}
          currentUserId={profile.id}
        />
      </PageStack>
    </AppShell>
  );
}

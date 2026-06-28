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

  const [activity, usersResult] = await Promise.all([
    fetchVehicleActivity(supabase, id),
    supabase
      .from("users")
      .select("id,full_name,email,avatar_color,active")
      .eq("active", true)
      .order("full_name", { ascending: true }),
  ]);

  const users: UserOption[] = ((usersResult.data ?? []) as Array<Record<string, unknown>>).map((u) => ({
    id: String(u.id ?? ""),
    label: (typeof u.full_name === "string" && u.full_name) || (typeof u.email === "string" ? u.email : "") || "משתמש",
    color: typeof u.avatar_color === "string" ? u.avatar_color : null,
  }));

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
          currentUserId={profile.id}
        />
      </PageStack>
    </AppShell>
  );
}

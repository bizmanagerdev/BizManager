import { notFound } from "next/navigation";
import { BuildingIcon, TrendDownIcon, TrendUpIcon } from "@/components/ui/icons";
import AppShell from "@/components/layout/AppShell";
import { requireStaffPage } from "@/lib/auth/roleAccess";
import { Card, CardContent } from "@/components/ui/card";
import { PageStack } from "@/components/layout/page-layout";
import { formatCurrency, type SalaryAgreementRow } from "@/lib/payroll";
import { fetchProperty, fetchPropertyActivity, propertyDisplayName } from "@/lib/properties";
import type { PropertyStaffUser } from "./PropertyDetailClient";
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
  tone?: "income" | "expense" | "warning" | "neutral";
  icon?: React.ReactNode;
}) {
  const color =
    tone === "income" ? "text-emerald-600" : tone === "expense" ? "text-destructive" : tone === "warning" ? "text-warning-strong" : "";
  return (
    <Card className="min-w-0">
      <CardContent className="p-3">
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          {icon}
          {label}
        </div>
        <div className={`mt-1 whitespace-nowrap text-lg font-semibold tabular-nums ${color}`}>{value}</div>
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
    // Unfiltered — a session's worker may since have gone inactive or lost
    // dashboard access, and their name still needs to resolve on this page.
    // Which USERS may be assigned/picked (task assignee, new-session worker)
    // is decided per-dialog client-side, not by this query.
    supabase
      .from("users")
      .select("id,full_name,email,role,active,payroll_worker_type,pay_tracking_mode,avatar_color")
      .order("full_name", { ascending: true }),
  ]);
  const net = activity.rollup.totalIncomeAmount - activity.rollup.paidExpenseAmount;

  const users: PropertyStaffUser[] = ((usersResult.data ?? []) as Array<Record<string, unknown>>).map((u) => ({
    id: String(u.id ?? ""),
    label: (typeof u.full_name === "string" && u.full_name) || (typeof u.email === "string" ? u.email : "") || "משתמש",
    color: typeof u.avatar_color === "string" ? u.avatar_color : null,
    role: typeof u.role === "string" ? u.role : null,
    active: u.active !== false,
    payrollWorkerType: typeof u.payroll_worker_type === "string" ? u.payroll_worker_type : null,
    payTrackingMode: typeof u.pay_tracking_mode === "string" ? u.pay_tracking_mode : null,
  }));

  // Scoped to the workers who actually have a session on this property — the
  // dialog's auto labor-cost suggestion needs their active rate.
  const sessionUserIds = Array.from(new Set(activity.sessions.map((s) => s.user_id).filter(Boolean)));
  const { data: salaryAgreementRows } =
    sessionUserIds.length > 0
      ? await supabase
          .from("salary_agreements")
          .select(
            "id,user_id,salary_type,hourly_rate,monthly_salary,valid_from,valid_to,notes,overtime_rate,standard_daily_hours,due_day_of_next_month,business_domain,project_id,property_id"
          )
          .in("user_id", sessionUserIds)
          .order("valid_from", { ascending: false })
      : { data: [] as SalaryAgreementRow[] };
  const salaryAgreements = (salaryAgreementRows ?? []) as SalaryAgreementRow[];

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

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            label="הוצאות ששולמו"
            value={formatCurrency(activity.rollup.paidExpenseAmount)}
            tone="expense"
            icon={<TrendDownIcon className="h-3.5 w-3.5" />}
          />
          <StatCard
            label="הוצאות צפויות"
            value={formatCurrency(activity.rollup.expectedExpenseAmount)}
            tone="warning"
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
          salaryAgreements={salaryAgreements}
          currentUserId={profile.id}
          currentUserRole={profile.role}
        />
      </PageStack>
    </AppShell>
  );
}

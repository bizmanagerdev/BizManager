import dynamic from "next/dynamic";
import { notFound } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { requireStaffPage } from "@/lib/auth/roleAccess";
import type { SalaryAgreementRow } from "@/lib/payroll";
import { fetchProperty, fetchPropertyActivity } from "@/lib/properties";
import type { PropertyStaffUser } from "./PropertyDetailClient";
import { PropertyDetailBodySkeleton } from "./PropertyPageSkeleton";

// While its code loads: the loading screen's own body (the heading and the
// figure cards above it are already the page's), so nothing swaps in between.
const PropertyDetailClient = dynamic(() => import("./PropertyDetailClient"), {
  loading: () => <PropertyDetailBodySkeleton />,
});

export const revalidate = 30;

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
      {/* One details page, like a project's or an order's (owner, 2026-10-20):
          the heading, the head row and the money are all the client's. */}
      <PropertyDetailClient
        propertyId={id}
        property={property}
        activity={activity}
        users={users}
        salaryAgreements={salaryAgreements}
        currentUserId={profile.id}
        currentUserRole={profile.role}
      />
    </AppShell>
  );
}

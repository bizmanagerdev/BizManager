import dynamic from "next/dynamic";
import { redirect } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import PageAlertBar from "@/components/reminders/PageAlertBar";
import { Card, CardContent } from "@/components/ui/card";
import { DetailPageSkeleton } from "@/components/layout/DetailPageSkeleton";
import { requireProfile, type UserRole } from "@/lib/auth/requireProfile";
import { loadPayrollPageData } from "@/lib/payroll-page-loader";

// This client component is ~5,600 lines (the whole salary/attendance engine).
// Lazy-loaded so a visitor doesn't download it before actually opening the
// page — same pattern already used for ProjectTabsClient.
const SalaryCenterClient = dynamic(() => import("@/app/(app)/payroll/SalaryCenterClient"), {
  loading: () => <DetailPageSkeleton />,
});

export default async function PayrollPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedParams = (await searchParams) ?? {};
  const defaultWorkerId = typeof resolvedParams.worker_id === "string" ? resolvedParams.worker_id : undefined;
  const { profile, supabase } = await requireProfile();

  // Office can manage worker hours (sessions) but not salary — salary is gated
  // client-side via canManageSalary and the admin-only protected data endpoint.
  if (profile.role !== "admin" && profile.role !== "office") {
    redirect("/no-access");
  }

  // The attendance queue lives on its own route (/payroll/attendance, a sub-tab
  // of עובדים in the sidebar), so this page no longer loads it at all.
  const { users, sessions, projectOptions, propertyOptions, periods, loadError } = await loadPayrollPageData(supabase);

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      {/* OUTSIDE the space-y-4 below — see tasks/page.tsx for why (space-y adds
          margin-top to any sibling with a preceding one, even PageAlertBar's
          own zero-height node, which read as a white gap that closed the
          instant every alert was dismissed). */}
      <PageAlertBar keys={["wage_overdue"]} />
      <div className="space-y-4 text-right" dir="rtl">
        {loadError ? (
          <Card>
            <CardContent className="py-6 text-sm text-destructive">
              {`שגיאה בטעינת מרכז השכר: ${loadError}`}
            </CardContent>
          </Card>
        ) : (
          <SalaryCenterClient
            viewerRole={profile.role as UserRole}
            publicUsers={users}
            publicSessions={sessions}
            projectOptions={projectOptions}
            propertyOptions={propertyOptions}
            publicPeriods={periods}
            initiallyUnlocked
            hasPasswordConfigured
            defaultWorkerId={defaultWorkerId}
          />
        )}
      </div>
    </AppShell>
  );
}

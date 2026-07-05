import { redirect } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import PageAlertBar from "@/components/reminders/PageAlertBar";
import { Card, CardContent } from "@/components/ui/card";
import SalaryCenterClient from "@/app/(app)/payroll/SalaryCenterClient";
import { requireProfile, type UserRole } from "@/lib/auth/requireProfile";
import { loadPayrollPageData } from "@/lib/payroll-page-loader";

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

  const { users, sessions, projectOptions, propertyOptions, periods, loadError } = await loadPayrollPageData(supabase);

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <div className="space-y-4 text-right" dir="rtl">
        <PageAlertBar keys={["wage_overdue", "session_unallocated"]} />
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

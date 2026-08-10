import { redirect } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import PageAlertBar from "@/components/reminders/PageAlertBar";
import { Card, CardContent } from "@/components/ui/card";
import SalaryCenterClient from "@/app/(app)/payroll/SalaryCenterClient";
import PhoneAttendanceQueue from "@/app/(app)/payroll/PhoneAttendanceQueue";
import { requireProfile, type UserRole } from "@/lib/auth/requireProfile";
import { loadPayrollPageData } from "@/lib/payroll-page-loader";
import { loadPhoneQueueData } from "@/lib/attendance/phone-reports";
import { normalizePayrollWorkerType, payrollWorkerTypeAllowsSessions } from "@/lib/payroll-worker-type";

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
  // Cost/pay is salary data — only compute it for admins (office manages hours, not salary).
  const phoneQueue = await loadPhoneQueueData(supabase, { includeCost: profile.role === "admin" });

  // Workers eligible for manual phone-attendance entry (active, session-logging types).
  const attendanceWorkers = users
    .filter(
      (u) =>
        u.active !== false &&
        (u.role === "worker" || u.role === "worker_no_access") &&
        payrollWorkerTypeAllowsSessions(normalizePayrollWorkerType(u.payroll_worker_type, u.pay_tracking_mode))
    )
    .map((u) => ({ id: u.id, name: u.full_name, phone: u.phone }));

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <div className="space-y-4 text-right" dir="rtl">
        <PageAlertBar keys={["wage_overdue", "session_unallocated"]} />
        <PhoneAttendanceQueue
          pending={phoneQueue.pending}
          open={phoneQueue.open}
          workers={attendanceWorkers}
          projectOptions={projectOptions}
          propertyOptions={propertyOptions}
        />
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

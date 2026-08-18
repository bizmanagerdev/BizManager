import { redirect } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import AttendanceQueuePanel from "@/components/attendance/AttendanceQueuePanel";
import { requireProfile } from "@/lib/auth/requireProfile";
import { loadPhoneQueueData } from "@/lib/attendance/phone-reports";
import { loadAttendanceRefData } from "@/lib/payroll-page-loader";

/**
 * "דיווחי נוכחות" — the attendance queue as its own page under עובדים: raw
 * phone / manually-logged clock in-outs, waiting for an admin to classify each
 * one into a business domain and approve it into a paid session. Its own route
 * (not a tab inside the salary center) so it has room for its own header,
 * summary and actions.
 *
 * Same gate as /payroll: admin runs it; office may manage hours but sees no
 * salary, so the per-shift cost is computed for admins only.
 */
export default async function PayrollAttendancePage() {
  const { profile, supabase } = await requireProfile();

  if (profile.role !== "admin" && profile.role !== "office") {
    redirect("/no-access");
  }

  const [{ projectOptions, propertyOptions }, phoneQueue] = await Promise.all([
    loadAttendanceRefData(supabase),
    loadPhoneQueueData(supabase, { includeCost: profile.role === "admin" }),
  ]);

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <div className="space-y-4 text-right" dir="rtl">
        <AttendanceQueuePanel
          pending={phoneQueue.pending}
          open={phoneQueue.open}
          projectOptions={projectOptions}
          propertyOptions={propertyOptions}
        />
      </div>
    </AppShell>
  );
}

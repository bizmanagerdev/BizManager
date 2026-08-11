import AppShell from "@/components/layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { requireProfile } from "@/lib/auth/requireProfile";
import {
  buildMonthlyHoursSummary,
  type PayrollPeriodRow,
  type PayslipRow,
  type SalaryAgreementRow,
  type WorkSessionRow,
  WORK_SESSIONS_TABLE,
} from "@/lib/payroll";
import ProfileClient from "@/app/(app)/profile/ProfileClient";
import PageTitle from "@/components/layout/PageTitle";
import { loadMyShiftState } from "@/lib/attendance/my-shift";
import { loadMyPayroll } from "@/lib/my-payroll";

type Row = Record<string, unknown>;

function asSessions(rows: Row[] | null | undefined) {
  return (rows ?? []) as unknown as WorkSessionRow[];
}

function asAgreements(rows: Row[] | null | undefined) {
  return (rows ?? []) as unknown as SalaryAgreementRow[];
}

function asPayslips(rows: Row[] | null | undefined) {
  return (rows ?? []) as unknown as PayslipRow[];
}

function asPeriods(rows: Row[] | null | undefined) {
  return (rows ?? []) as unknown as PayrollPeriodRow[];
}

type LinkedOption = {
  id: string;
  label: string;
};

export default async function ProfilePage() {
  const { profile, supabase } = await requireProfile();

  const { data: sessionRows, error: sessionsError } = await supabase
    .from(WORK_SESSIONS_TABLE)
    .select("id,user_id,clock_in,clock_out,worked_minutes,notes,business_domain,project_id,property_id")
    .eq("user_id", profile.id)
    .order("clock_in", { ascending: false })
    .limit(300);

  const { data: agreementRows, error: agreementsError } = await supabase
    .from("salary_agreements")
    .select(
      "id,user_id,salary_type,hourly_rate,monthly_salary,valid_from,valid_to,notes,overtime_rate,standard_daily_hours,due_day_of_next_month"
    )
    .eq("user_id", profile.id)
    .order("valid_from", { ascending: false });

  const { data: payslipRows, error: payslipsError } = await supabase
    .from("payslips")
    .select(
      "id,payroll_period_id,user_id,calculated_salary_type,total_work_minutes,calculated_base_salary,manual_adjustments,gross_salary,notes"
    )
    .eq("user_id", profile.id)
    .limit(24);

  const periodIds = ((payslipRows ?? []) as Row[])
    .map((row) => (typeof row.payroll_period_id === "string" ? row.payroll_period_id : ""))
    .filter(Boolean);

  const { data: periodRows, error: periodsError } = periodIds.length
    ? await supabase
        .from("payroll_periods")
        .select("id,period_month,start_date,end_date,status")
        .in("id", periodIds)
    : { data: [], error: null };

  const [{ data: projectRows, error: projectsError }, { data: propertyRows, error: propertiesError }] =
    await Promise.all([
      supabase
        .from("project_dashboard_view")
        .select("id,name")
        .order("name", { ascending: true })
        .range(0, 199),
      supabase
        .from("properties")
        .select("id,address")
        .order("address", { ascending: true })
        .range(0, 199),
    ]);

  // Per-user text-size multiplier. Tolerant of the column not existing yet
  // (before db/sql/add_user_font_scale.sql is run) — falls back to null so the
  // client uses its localStorage value.
  const { data: fontScaleRow } = await supabase
    .from("users")
    .select("font_scale")
    .eq("id", profile.id)
    .maybeSingle();
  const rawFontScale = (fontScaleRow as { font_scale?: unknown } | null)?.font_scale;
  const initialFontScale = typeof rawFontScale === "number" && rawFontScale > 0 ? rawFontScale : null;

  // Chosen avatar color — separate query so a missing column (before
  // db/sql/add_user_avatar_color.sql runs) can't break the font-scale load.
  const { data: avatarColorRow } = await supabase
    .from("users")
    .select("avatar_color")
    .eq("id", profile.id)
    .maybeSingle();
  const rawAvatarColor = (avatarColorRow as { avatar_color?: unknown } | null)?.avatar_color;
  const initialAvatarColor = typeof rawAvatarColor === "string" ? rawAvatarColor : null;

  // A worker's shifts live in the approval queue until the boss classifies them,
  // so his attendance tab reads from there rather than from attendance_sessions.
  const isWorker = profile.role === "worker";
  const shiftState = isWorker
    ? await loadMyShiftState(supabase, profile.id, { limit: 30 })
    : { open: null, pending: [], history: [] };

  // Earned / paid / still owed, from worker_debt_items_view — the same view the
  // salary centre reads, so a worker and his boss can never quote different
  // numbers. Everyone gets this on their own profile, not just workers.
  const myPayroll = await loadMyPayroll(supabase, profile.id);

  const loadError =
    sessionsError?.message ??
    agreementsError?.message ??
    payslipsError?.message ??
    periodsError?.message ??
    projectsError?.message ??
    propertiesError?.message ??
    null;

  const sessions = asSessions(sessionRows);
  const agreements = asAgreements(agreementRows);
  const payslips = asPayslips(payslipRows);
  const periods = asPeriods(periodRows);
  const monthlySummaries = buildMonthlyHoursSummary(sessions);
  const projectOptions: LinkedOption[] = ((projectRows ?? []) as Row[])
    .map((row) => ({
      id: typeof row.id === "string" ? row.id : "",
      label: typeof row.name === "string" && row.name.trim() ? row.name.trim() : "",
    }))
    .filter((row) => row.id && row.label);
  const propertyOptions: LinkedOption[] = ((propertyRows ?? []) as Row[])
    .map((row) => ({
      id: typeof row.id === "string" ? row.id : "",
      label: typeof row.address === "string" && row.address.trim() ? row.address.trim() : "",
    }))
    .filter((row) => row.id && row.label);

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <div className="space-y-4">
        <PageTitle title="הפרופיל שלי" subtitle={profile.full_name ?? undefined} />
        {/* Desktop only: on a phone the top bar already says "הפרופיל שלי" and
            the name right under it, so repeating both here was the same line
            twice. Desktop has no such header, and the details card below is
            where the email/phone belong anyway. */}
        <div className="hidden lg:block">
          <h1 className="text-2xl font-semibold">{profile.full_name ?? profile.email ?? "עובד"}</h1>
          {[profile.email, profile.phone].filter(Boolean).length ? (
            <p className="text-sm text-muted-foreground">
              {[profile.email, profile.phone].filter(Boolean).join(" · ")}
            </p>
          ) : null}
        </div>

        {loadError ? (
          <Card>
            <CardContent className="py-6 text-sm text-destructive">
              שגיאה בטעינת נתוני העובד: {loadError}
            </CardContent>
          </Card>
        ) : (
          <ProfileClient
            profile={profile}
            initialFontScale={initialFontScale}
            initialAvatarColor={initialAvatarColor}
            sessions={sessions}
            agreements={agreements}
            payslips={payslips}
            periods={periods}
            monthlySummaries={monthlySummaries}
            projectOptions={projectOptions}
            propertyOptions={propertyOptions}
            isWorker={isWorker}
            openShiftReport={shiftState.open}
            pendingShiftReports={shiftState.pending}
            payTotals={myPayroll.payUnavailable ? null : myPayroll.totals}
            payBySessionId={
              myPayroll.payUnavailable
                ? {}
                : Object.fromEntries(
                    myPayroll.debtItems
                      .filter((item) => item.sourceType === "session")
                      .map((item) => [item.sourceId, item.status])
                  )
            }
          />
        )}
      </div>
    </AppShell>
  );
}

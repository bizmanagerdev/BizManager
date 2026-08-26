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
import DashboardCustomizer from "@/components/dashboard/DashboardCustomizer";
import { sanitizePrefs } from "@/lib/dashboard/widgets";
import PageTitle from "@/components/layout/PageTitle";
import { loadMyShiftState } from "@/lib/attendance/my-shift";
import { t } from "@/lib/i18n/t";
import { profileDict } from "@/lib/i18n/dictionaries/profile";
import { loadMyPayroll } from "@/lib/my-payroll";
import { propertyDisplayName } from "@/lib/properties";
import {
  BONUS_ITEM_TYPE,
  PAYSLIP_ITEM_COLUMNS,
  PAYSLIP_ITEMS_TABLE,
  type PayslipItemRow,
} from "@/lib/payroll-bonuses";

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
    .select("id,user_id,clock_in,clock_out,worked_minutes,notes,notes_he,business_domain,project_id,property_id")
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
        .select("id,name,address")
        .order("address", { ascending: true })
        .range(0, 199),
    ]);

  // Per-user text-size multipliers, one per device class. Tolerant of either
  // column not existing yet (font_scale predates font_scale_mobile, migration
  // 20260818000000) — a failed read falls back to null and the client uses its
  // localStorage value.
  const { data: fontScaleRow } = await supabase
    .from("users")
    .select("font_scale,font_scale_mobile")
    .eq("id", profile.id)
    .maybeSingle();
  const fontScales = fontScaleRow as { font_scale?: unknown; font_scale_mobile?: unknown } | null;
  const positive = (value: unknown) => (typeof value === "number" && value > 0 ? value : null);
  const initialFontScale = positive(fontScales?.font_scale);
  const initialFontScaleMobile = positive(fontScales?.font_scale_mobile);

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

  // His own bonuses — a payslip_items row each, whether or not the month has been
  // closed into a payslip yet. Tolerant: before the bonus migration runs there is
  // no user_id / item_date column, and the rest of the profile must still render.
  const myBonusesResult = await supabase
    .from(PAYSLIP_ITEMS_TABLE)
    .select(PAYSLIP_ITEM_COLUMNS)
    .eq("user_id", profile.id)
    .eq("item_type", BONUS_ITEM_TYPE)
    .order("item_date", { ascending: false })
    .range(0, 99);
  const myBonuses = myBonusesResult.error ? [] : ((myBonusesResult.data ?? []) as PayslipItemRow[]);

  // What each shift was actually ON. The domain alone ("פרויקטים") is the same
  // word on every project row, so resolve the specific job/address by id —
  // queried directly rather than off the pickers below, which are capped lists
  // and (for a worker) may not include a project at all.
  const sessionRows2 = asSessions(sessionRows);
  const linkedProjectIds = [
    ...new Set(sessionRows2.map((s) => s.project_id).filter((id): id is string => Boolean(id))),
  ];
  const linkedPropertyIds = [
    ...new Set(sessionRows2.map((s) => s.property_id).filter((id): id is string => Boolean(id))),
  ];
  const [linkedProjectsRes, linkedPropertiesRes] = await Promise.all([
    linkedProjectIds.length
      ? supabase.from("projects").select("id,name").in("id", linkedProjectIds)
      : Promise.resolve({ data: [] as Row[] }),
    linkedPropertyIds.length
      ? supabase.from("properties").select("id,name,address").in("id", linkedPropertyIds)
      : Promise.resolve({ data: [] as Row[] }),
  ]);
  const linkLabelById = new Map<string, string>();
  for (const row of (linkedProjectsRes.data ?? []) as Row[]) {
    const id = typeof row.id === "string" ? row.id : "";
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (id && name) linkLabelById.set(id, name);
  }
  for (const row of (linkedPropertiesRes.data ?? []) as Row[]) {
    const id = typeof row.id === "string" ? row.id : "";
    const label = propertyDisplayName({
      name: typeof row.name === "string" ? row.name : null,
      address: typeof row.address === "string" ? row.address : "",
    });
    if (id && label) linkLabelById.set(id, label);
  }
  const linkLabelBySessionId: Record<string, string> = {};
  for (const session of sessionRows2) {
    const linkId = session.project_id ?? session.property_id;
    const label = linkId ? linkLabelById.get(linkId) : undefined;
    if (label) linkLabelBySessionId[session.id] = label;
  }

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
  const monthlySummaries = buildMonthlyHoursSummary(sessions, profile.locale);
  const projectOptions: LinkedOption[] = ((projectRows ?? []) as Row[])
    .map((row) => ({
      id: typeof row.id === "string" ? row.id : "",
      label: typeof row.name === "string" && row.name.trim() ? row.name.trim() : "",
    }))
    .filter((row) => row.id && row.label);
  const propertyOptions: LinkedOption[] = ((propertyRows ?? []) as Row[])
    .map((row) => ({
      id: typeof row.id === "string" ? row.id : "",
      label: propertyDisplayName({
        name: typeof row.name === "string" ? row.name : null,
        address: typeof row.address === "string" ? row.address : "",
      }),
    }))
    .filter((row) => row.id && row.label);

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <div className="space-y-4">
        {/* No name/email banner above the tabs: this is YOUR profile — you know
            who you are — and the details card in the first tab is where those
            fields live anyway. (The phone's top bar still names the screen — with
            the active tab's name, which ProfileClient sets since only it knows
            which tab is open. Hence the title here only for the error branch,
            where there are no tabs to mirror.) */}

        {loadError ? (
          <>
            <PageTitle
              title={t(profileDict, profile.locale, "pageTitle")}
              subtitle={profile.full_name ?? undefined}
            />
            <Card>
              <CardContent className="py-6 text-sm text-destructive">
                {t(profileDict, profile.locale, "loadErrorPrefix")}{loadError}
              </CardContent>
            </Card>
          </>
        ) : (
          <ProfileClient
            profile={profile}
            locale={profile.locale}
            initialFontScale={initialFontScale}
            initialFontScaleMobile={initialFontScaleMobile}
            initialAvatarColor={initialAvatarColor}
            sessions={sessions}
            agreements={agreements}
            payslips={payslips}
            periods={periods}
            monthlySummaries={monthlySummaries}
            projectOptions={projectOptions}
            propertyOptions={propertyOptions}
            isWorker={isWorker}
            dashboardCustomizer={
              // Nothing worth rearranging on a worker's board — it's the clock,
              // his tasks and his deliveries.
              isWorker ? null : (
                <DashboardCustomizer role={profile.role} initialPrefs={sanitizePrefs(profile.dashboard_prefs)} />
              )
            }
            openShiftReport={shiftState.open}
            pendingShiftReports={shiftState.pending}
            myBonuses={myBonuses}
            linkLabelBySessionId={linkLabelBySessionId}
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

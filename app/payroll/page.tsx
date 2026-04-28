import { redirect } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { requireProfile, type UserRole } from "@/lib/auth/requireProfile";
import { isPayrollAdminPasswordConfigured, isPayrollAdminUnlocked } from "@/lib/payroll-admin-auth";
import type { PayrollPeriodRow, PayslipRow, SalaryAgreementRow, WorkSessionRow } from "@/lib/payroll";
import PayrollAdminClient from "@/app/payroll/PayrollAdminClient";

type Row = Record<string, unknown>;

type UserRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  active: boolean | null;
};

function asUsers(rows: Row[] | null | undefined) {
  return (rows ?? []) as unknown as UserRow[];
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

function asSessions(rows: Row[] | null | undefined) {
  return (rows ?? []) as unknown as WorkSessionRow[];
}

type LinkedOption = {
  id: string;
  label: string;
};

export default async function PayrollPage() {
  const { profile, supabase } = await requireProfile();

  if (!["admin", "office"].includes(profile.role)) {
    redirect("/no-access");
  }

  const canManageSalary = profile.role === "admin";
  const unlocked = canManageSalary ? await isPayrollAdminUnlocked() : false;
  const hasPasswordConfigured = canManageSalary ? isPayrollAdminPasswordConfigured() : false;

  let users: UserRow[] = [];
  let agreements: SalaryAgreementRow[] = [];
  let payslips: PayslipRow[] = [];
  let periods: PayrollPeriodRow[] = [];
  let sessions: WorkSessionRow[] = [];
  let projectOptions: LinkedOption[] = [];
  let propertyOptions: LinkedOption[] = [];
  let loadError: string | null = null;

  {
    const { data: userRows, error: usersError } = await supabase
      .from("users")
      .select("id,full_name,email,phone,role,active")
      .order("full_name", { ascending: true })
      .range(0, 499);

    const userIds = ((userRows ?? []) as Row[])
      .map((row) => (typeof row.id === "string" ? row.id : ""))
      .filter(Boolean);

    const { data: agreementRows, error: agreementsError } = canManageSalary && unlocked && userIds.length
      ? await supabase
          .from("salary_agreements")
          .select(
            "id,user_id,salary_type,hourly_rate,monthly_salary,valid_from,valid_to,notes,overtime_rate,standard_daily_hours"
          )
          .in("user_id", userIds)
          .order("valid_from", { ascending: false })
      : { data: [], error: null };

    const { data: payslipRows, error: payslipsError } = canManageSalary && unlocked && userIds.length
      ? await supabase
          .from("payslips")
          .select(
            "id,payroll_period_id,user_id,calculated_salary_type,total_work_minutes,calculated_base_salary,manual_adjustments,gross_salary,notes"
          )
          .in("user_id", userIds)
          .limit(500)
      : { data: [], error: null };

    const periodIds = ((payslipRows ?? []) as Row[])
      .map((row) => (typeof row.payroll_period_id === "string" ? row.payroll_period_id : ""))
      .filter(Boolean);

    const { data: periodRows, error: periodsError } = canManageSalary && unlocked && periodIds.length
      ? await supabase
          .from("payroll_periods")
          .select("id,period_month,start_date,end_date,status")
          .in("id", periodIds)
      : { data: [], error: null };

    const { data: sessionRows, error: sessionsError } = userIds.length
      ? await supabase
          .from("attendance_sessions")
          .select(
            "id,user_id,clock_in,clock_out,worked_minutes,labor_cost,is_billable_to_customer,bill_to_customer_amount,billing_status,notes,business_domain,project_id,property_id"
          )
          .in("user_id", userIds)
          .order("clock_in", { ascending: false })
          .range(0, 1999)
      : { data: [], error: null };

    const [{ data: projectRows, error: projectsError }, { data: propertyRows, error: propertiesError }] =
      await Promise.all([
        supabase
          .from("project_dashboard_view")
          .select("id,name")
          .order("name", { ascending: true })
          .range(0, 499),
        supabase
          .from("properties")
          .select("id,address")
          .order("address", { ascending: true })
          .range(0, 499),
      ]);

    loadError =
      usersError?.message ??
      agreementsError?.message ??
      payslipsError?.message ??
      periodsError?.message ??
      sessionsError?.message ??
      projectsError?.message ??
      propertiesError?.message ??
      null;

    users = asUsers(userRows);
    agreements = asAgreements(agreementRows);
    payslips = asPayslips(payslipRows);
    periods = asPeriods(periodRows);
    sessions = asSessions(sessionRows);
    projectOptions = ((projectRows ?? []) as Row[])
      .map((row) => ({
        id: typeof row.id === "string" ? row.id : "",
        label: typeof row.name === "string" && row.name.trim() ? row.name.trim() : "",
      }))
      .filter((row) => row.id && row.label);
    propertyOptions = ((propertyRows ?? []) as Row[])
      .map((row) => ({
        id: typeof row.id === "string" ? row.id : "",
        label: typeof row.address === "string" && row.address.trim() ? row.address.trim() : "",
      }))
      .filter((row) => row.id && row.label);
  }

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined}>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">מרכז שכר</h1>
          <p className="text-sm text-muted-foreground">
            צפייה בשכר העובדים, היסטוריית הסכמים והוספת עדכוני שכר חדשים.
          </p>
        </div>

        {loadError ? (
          <Card>
            <CardContent className="py-6 text-sm text-destructive">
              שגיאה בטעינת נתוני השכר: {loadError}
            </CardContent>
          </Card>
        ) : (
          <PayrollAdminClient
            viewerRole={profile.role as UserRole}
            unlocked={unlocked}
            hasPasswordConfigured={hasPasswordConfigured}
            users={users}
            agreements={agreements}
            payslips={payslips}
            periods={periods}
            sessions={sessions}
            projectOptions={projectOptions}
            propertyOptions={propertyOptions}
          />
        )}
      </div>
    </AppShell>
  );
}

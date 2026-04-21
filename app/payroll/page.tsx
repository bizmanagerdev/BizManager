import { redirect } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { requireProfile } from "@/lib/auth/requireProfile";
import { isPayrollAdminPasswordConfigured, isPayrollAdminUnlocked } from "@/lib/payroll-admin-auth";
import type { PayrollPeriodRow, PayslipRow, SalaryAgreementRow } from "@/lib/payroll";
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

export default async function PayrollPage() {
  const { profile, supabase } = await requireProfile();

  if (profile.role !== "admin") {
    redirect("/no-access");
  }

  const unlocked = await isPayrollAdminUnlocked();
  const hasPasswordConfigured = isPayrollAdminPasswordConfigured();

  let users: UserRow[] = [];
  let agreements: SalaryAgreementRow[] = [];
  let payslips: PayslipRow[] = [];
  let periods: PayrollPeriodRow[] = [];
  let loadError: string | null = null;

  if (unlocked) {
    const { data: userRows, error: usersError } = await supabase
      .from("users")
      .select("id,full_name,email,phone,role,active")
      .order("full_name", { ascending: true })
      .range(0, 499);

    const userIds = ((userRows ?? []) as Row[])
      .map((row) => (typeof row.id === "string" ? row.id : ""))
      .filter(Boolean);

    const { data: agreementRows, error: agreementsError } = userIds.length
      ? await supabase
          .from("salary_agreements")
          .select(
            "id,user_id,salary_type,hourly_rate,monthly_salary,valid_from,valid_to,notes,overtime_rate,standard_daily_hours"
          )
          .in("user_id", userIds)
          .order("valid_from", { ascending: false })
      : { data: [], error: null };

    const { data: payslipRows, error: payslipsError } = userIds.length
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

    const { data: periodRows, error: periodsError } = periodIds.length
      ? await supabase
          .from("payroll_periods")
          .select("id,period_month,start_date,end_date,status")
          .in("id", periodIds)
      : { data: [], error: null };

    loadError =
      usersError?.message ??
      agreementsError?.message ??
      payslipsError?.message ??
      periodsError?.message ??
      null;

    users = asUsers(userRows);
    agreements = asAgreements(agreementRows);
    payslips = asPayslips(payslipRows);
    periods = asPeriods(periodRows);
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
            unlocked={unlocked}
            hasPasswordConfigured={hasPasswordConfigured}
            users={users}
            agreements={agreements}
            payslips={payslips}
            periods={periods}
          />
        )}
      </div>
    </AppShell>
  );
}

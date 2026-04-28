import { redirect } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import SalaryCenterClient from "@/app/payroll/SalaryCenterClient";
import { requireProfile, type UserRole } from "@/lib/auth/requireProfile";
import { collectLockedSessionIds, type SalaryCenterProjectOption, type SalaryCenterUserRow, type SessionPublicRow } from "@/lib/payroll-center";
import type { PayrollPeriodRow } from "@/lib/payroll";
import { isPayrollAdminPasswordConfigured, isPayrollAdminUnlocked } from "@/lib/payroll-admin-auth";

type Row = Record<string, unknown>;

function mapUsers(rows: Row[] | null | undefined): SalaryCenterUserRow[] {
  return ((rows ?? []) as Array<Row>).map((row) => ({
    id: typeof row.id === "string" ? row.id : "",
    full_name: typeof row.full_name === "string" ? row.full_name : null,
    email: typeof row.email === "string" ? row.email : null,
    phone: typeof row.phone === "string" ? row.phone : null,
    role: typeof row.role === "string" ? row.role : null,
    active: typeof row.active === "boolean" ? row.active : null,
    system_access: typeof row.system_access === "boolean" ? row.system_access : null,
  }));
}

function mapSessions(rows: Row[] | null | undefined, lockedIds: Set<string>): SessionPublicRow[] {
  return ((rows ?? []) as Array<Row>).map((row) => {
    const id = typeof row.id === "string" ? row.id : "";
    return {
      id,
      user_id: typeof row.user_id === "string" ? row.user_id : "",
      clock_in: typeof row.clock_in === "string" ? row.clock_in : "",
      clock_out: typeof row.clock_out === "string" ? row.clock_out : null,
      worked_minutes:
        typeof row.worked_minutes === "number" || typeof row.worked_minutes === "string"
          ? row.worked_minutes
          : null,
      is_billable_to_customer:
        typeof row.is_billable_to_customer === "boolean" ? row.is_billable_to_customer : null,
      bill_to_customer_amount:
        typeof row.bill_to_customer_amount === "number" || typeof row.bill_to_customer_amount === "string"
          ? row.bill_to_customer_amount
          : null,
      billing_status: typeof row.billing_status === "string" ? row.billing_status : null,
      notes: typeof row.notes === "string" ? row.notes : null,
      business_domain: typeof row.business_domain === "string" ? row.business_domain : null,
      project_id: typeof row.project_id === "string" ? row.project_id : null,
      property_id: typeof row.property_id === "string" ? row.property_id : null,
      locked: lockedIds.has(id),
    };
  });
}

function mapOptions(rows: Row[] | null | undefined, labelKey: "name" | "address"): SalaryCenterProjectOption[] {
  return ((rows ?? []) as Array<Row>)
    .map((row) => ({
      id: typeof row.id === "string" ? row.id : "",
      label: typeof row[labelKey] === "string" ? String(row[labelKey]).trim() : "",
    }))
    .filter((row) => row.id && row.label);
}

export default async function PayrollPage() {
  const { profile, supabase } = await requireProfile();

  if (!["admin", "office"].includes(profile.role)) {
    redirect("/no-access");
  }

  const hasPasswordConfigured = profile.role === "admin" ? isPayrollAdminPasswordConfigured() : false;
  const unlocked = profile.role === "admin" ? await isPayrollAdminUnlocked() : false;

  const [
    usersResult,
    sessionsResult,
    projectsResult,
    propertiesResult,
    periodsResult,
  ] = await Promise.all([
    supabase
      .from("users")
      .select("id,full_name,email,phone,role,active,system_access")
      .or("role.eq.admin,role.eq.office,role.eq.worker,role.eq.worker_no_access")
      .order("full_name", { ascending: true })
      .range(0, 999),
    supabase
      .from("attendance_sessions")
      .select(
        "id,user_id,clock_in,clock_out,worked_minutes,is_billable_to_customer,bill_to_customer_amount,billing_status,notes,business_domain,project_id,property_id"
      )
      .order("clock_in", { ascending: false })
      .range(0, 4999),
    supabase.from("project_dashboard_view").select("id,name").order("name", { ascending: true }).range(0, 999),
    supabase.from("properties").select("id,address").order("address", { ascending: true }).range(0, 999),
    supabase.from("payroll_periods").select("id,period_month,start_date,end_date,status").range(0, 119),
  ]);

  const loadError =
    usersResult.error?.message ??
    sessionsResult.error?.message ??
    projectsResult.error?.message ??
    propertiesResult.error?.message ??
    periodsResult.error?.message ??
    null;

  const periods = (periodsResult.data ?? []) as PayrollPeriodRow[];
  const lockedIds = collectLockedSessionIds(
    (((sessionsResult.data ?? []) as Row[]) as Array<{ id: string; clock_in: string }>).map((row) => ({
      id: row.id,
      clock_in: row.clock_in,
    })),
    periods
  );

  const users = mapUsers((usersResult.data ?? []) as Row[]);
  const sessions = mapSessions((sessionsResult.data ?? []) as Row[], lockedIds);
  const projectOptions = mapOptions((projectsResult.data ?? []) as Row[], "name");
  const propertyOptions = mapOptions((propertiesResult.data ?? []) as Row[], "address");

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined}>
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
            initiallyUnlocked={unlocked}
            hasPasswordConfigured={hasPasswordConfigured}
          />
        )}
      </div>
    </AppShell>
  );
}

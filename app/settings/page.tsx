import { redirect } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import SettingsTabs from "@/app/settings/SettingsTabs";
import { loadMorningSettings, type MorningSettings } from "@/lib/morning/settings";
import type { TaskPriority, TaskStatus } from "@/components/tasks/TaskUpsertDialog";
import type { RecurringExpenseTemplateItem } from "@/app/financial/RecurringExpensesManager";

type Row = Record<string, unknown>;

function getString(row: Row | null | undefined, key: string) {
  const v = row?.[key];
  return typeof v === "string" ? v : null;
}

function getNumber(row: Row | null | undefined, key: string) {
  const v = row?.[key];
  if (typeof v === "number") return v;
  if (typeof v === "string") { const n = Number(v); return Number.isFinite(n) ? n : null; }
  return null;
}

function looksLikeMissingSchema(msg: string) {
  const m = msg.toLowerCase();
  return m.includes("does not exist") || m.includes("could not find") || m.includes("schema cache");
}

function normalizePriority(v: string | null): TaskPriority {
  return v === "low" || v === "medium" || v === "high" || v === "urgent" ? v : "medium";
}

function normalizeStatus(v: string | null): TaskStatus {
  return v === "todo" || v === "in_progress" || v === "blocked" || v === "done" || v === "cancelled" ? v : "todo";
}

export default async function SettingsPage() {
  const { profile, supabase } = await requireProfile();
  if (profile.role !== "admin") {
    redirect("/no-access");
  }

  const isAdmin = true;
  const canManage = true;

  // ── Shared lookups ──────────────────────────────────────────────────────
  const [usersResult, projectsResult, propertiesResult] = await Promise.all([
    supabase.from("users").select("id,full_name,email").eq("active", true)
      .order("full_name", { ascending: true }).range(0, 499),
    supabase.from("project_dashboard_view").select("id,name,customer_name")
      .order("updated_at", { ascending: false }).range(0, 999),
    supabase.from("properties").select("id,address,is_active")
      .order("address", { ascending: true }).range(0, 999),
  ]);

  const users = ((usersResult.data ?? []) as Row[])
    .map((r) => ({ id: getString(r, "id") ?? "", label: (getString(r, "full_name") ?? getString(r, "email") ?? "").trim() }))
    .filter((u) => u.id && u.label);

  const projectOptions = ((projectsResult.data ?? []) as Row[])
    .map((r) => {
      const id = getString(r, "id") ?? "";
      const name = getString(r, "name") ?? "";
      const customer = getString(r, "customer_name");
      return { id, label: customer ? `${name} (${customer})` : name };
    })
    .filter((o) => o.id && o.label);

  const propertyOptions = ((propertiesResult.data ?? []) as Row[])
    .filter((r) => r.is_active !== false)
    .map((r) => ({ id: getString(r, "id") ?? "", label: getString(r, "address") ?? "" }))
    .filter((o) => o.id && o.label);

  // ── Recurring tasks ─────────────────────────────────────────────────────
  let taskTemplates: ReturnType<typeof buildTaskTemplates> = [];
  let taskMissingSchema = false;

  if (canManage) {
    const [templatesResult, assigneesResult] = await (async () => {
      const tr = await supabase
        .from("recurring_task_templates")
        .select("id,subject_template,description_template,business_domain,project_id,property_id,default_priority,default_status,create_day_of_month,due_day_of_month,start_date,end_date,is_active")
        .order("created_at", { ascending: true });

      const missingSchema = Boolean(tr.error?.message && looksLikeMissingSchema(tr.error.message));

      const ar =
        missingSchema || (tr.data ?? []).length === 0
          ? { data: [], error: null }
          : await supabase
              .from("recurring_task_template_assignees")
              .select("recurring_task_template_id,user_id")
              .in("recurring_task_template_id",
                ((tr.data ?? []) as Row[]).map((r) => getString(r, "id")).filter((v): v is string => Boolean(v))
              );

      return [tr, ar];
    })();

    taskMissingSchema = Boolean(
      templatesResult.error?.message && looksLikeMissingSchema(templatesResult.error.message)
    );

    const assigneeMap = new Map<string, string[]>();
    ((assigneesResult.data ?? []) as Row[]).forEach((r) => {
      const tid = getString(r, "recurring_task_template_id");
      const uid = getString(r, "user_id");
      if (!tid || !uid) return;
      assigneeMap.set(tid, [...(assigneeMap.get(tid) ?? []), uid]);
    });

    taskTemplates = buildTaskTemplates((templatesResult.data ?? []) as Row[], assigneeMap);
  }

  // ── Recurring expenses ──────────────────────────────────────────────────
  let expenseTemplates: RecurringExpenseTemplateItem[] = [];
  let expenseMissingSchema = false;
  let orderOptions: Array<{ id: string; label: string }> = [];

  if (canManage) {
    const [expResult, ordersResult] = await Promise.all([
      supabase
        .from("recurring_expense_templates")
        .select("id,template_name,category,amount,description_template,notes_template,business_domain,project_id,order_id,property_id,included_in_base_price,billed_to_customer,project_expense_notes_template,frequency,create_day_of_month,expense_day_of_month,create_month_of_year,expense_month_of_year,start_date,end_date,is_active")
        .order("created_at", { ascending: true }),
      supabase
        .from("order_overview_view")
        .select("order_id,customer_name,order_date")
        .order("order_date", { ascending: false })
        .range(0, 499),
    ]);

    expenseMissingSchema = Boolean(expResult.error?.message && looksLikeMissingSchema(expResult.error.message));

    if (!expenseMissingSchema) {
      expenseTemplates = ((expResult.data ?? []) as Row[]).map((r) => ({
        id: getString(r, "id") ?? "",
        template_name: getString(r, "template_name") ?? "",
        category: getString(r, "category") ?? "",
        amount: getNumber(r, "amount") ?? 0,
        description_template: getString(r, "description_template"),
        notes_template: getString(r, "notes_template"),
        business_domain: getString(r, "business_domain") ?? "general_business",
        project_id: getString(r, "project_id"),
        order_id: getString(r, "order_id"),
        property_id: getString(r, "property_id"),
        included_in_base_price: r.included_in_base_price === true,
        billed_to_customer: r.billed_to_customer === true,
        project_expense_notes_template: getString(r, "project_expense_notes_template"),
        frequency: getString(r, "frequency") === "yearly" ? "yearly" : "monthly",
        create_day_of_month: getNumber(r, "create_day_of_month") ?? 1,
        expense_day_of_month: getNumber(r, "expense_day_of_month") ?? 1,
        create_month_of_year: getNumber(r, "create_month_of_year"),
        expense_month_of_year: getNumber(r, "expense_month_of_year"),
        start_date: getString(r, "start_date"),
        end_date: getString(r, "end_date"),
        is_active: r.is_active !== false,
      })) as RecurringExpenseTemplateItem[];
    }

    orderOptions = ((ordersResult.data ?? []) as Row[]).map((r) => {
      const id = getString(r, "order_id") ?? "";
      const customer = getString(r, "customer_name") ?? "";
      const date = getString(r, "order_date") ?? "";
      return { id, label: customer ? `${customer} (${date})` : id };
    }).filter((o) => o.id);
  }

  // ── Morning integration (admin only) ────────────────────────────────────
  let morningSettings: MorningSettings | null = null;
  if (isAdmin) {
    morningSettings = await loadMorningSettings(supabase);
  }

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <SettingsTabs
        isAdmin={isAdmin}
        users={users}
        taskTemplates={taskTemplates}
        taskProjects={projectOptions}
        taskProperties={propertyOptions}
        taskMissingSchema={taskMissingSchema}
        expenseTemplates={expenseTemplates}
        expenseProjects={projectOptions}
        expenseProperties={propertyOptions}
        expenseOrders={orderOptions}
        expenseMissingSchema={expenseMissingSchema}
        morningSettings={morningSettings}
      />
    </AppShell>
  );
}

function buildTaskTemplates(rows: Row[], assigneeMap: Map<string, string[]>) {
  return rows.map((r) => {
    const id = getString(r, "id") ?? "";
    return {
      id,
      subject_template: getString(r, "subject_template") ?? "",
      description_template: getString(r, "description_template"),
      business_domain: getString(r, "business_domain") ?? "general_business",
      project_id: getString(r, "project_id"),
      property_id: getString(r, "property_id"),
      default_priority: normalizePriority(getString(r, "default_priority")),
      default_status: normalizeStatus(getString(r, "default_status")),
      create_day_of_month: typeof r.create_day_of_month === "number" ? r.create_day_of_month : Number(r.create_day_of_month ?? 1) || 1,
      due_day_of_month: typeof r.due_day_of_month === "number" ? r.due_day_of_month : Number(r.due_day_of_month ?? 1) || 1,
      start_date: getString(r, "start_date"),
      end_date: getString(r, "end_date"),
      is_active: r.is_active !== false,
      assignee_user_ids: assigneeMap.get(id) ?? [],
    };
  });
}

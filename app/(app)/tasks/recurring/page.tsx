import { redirect } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import type { TaskPriority, TaskStatus } from "@/components/tasks/TaskUpsertDialog";
import { Card, CardContent } from "@/components/ui/card";
import RecurringTasksClient from "@/app/(app)/tasks/recurring/RecurringTasksClient";
import { TasksTabs } from "@/components/tasks/TasksTabs";
import { requireProfile } from "@/lib/auth/requireProfile";

type Row = Record<string, unknown>;

function getString(row: Row | null | undefined, key: string) {
  const value = row?.[key];
  return typeof value === "string" ? value : null;
}

function looksLikeMissingSchema(message: string) {
  const value = message.toLowerCase();
  return value.includes("does not exist") || value.includes("could not find") || value.includes("schema cache");
}

function normalizePriority(value: string | null): TaskPriority {
  return value === "low" || value === "medium" || value === "high" || value === "urgent" ? value : "medium";
}

function normalizeStatus(value: string | null): TaskStatus {
  return value === "todo" || value === "in_progress" || value === "blocked" || value === "done" || value === "cancelled"
    ? value
    : "todo";
}

export default async function RecurringTasksPage() {
  const { profile, supabase } = await requireProfile();

  if (profile.role !== "admin" && profile.role !== "office") {
    redirect("/no-access");
  }

  const [templatesResult, projectsResult, propertiesResult, usersResult] = await Promise.all([
    supabase
      .from("recurring_task_templates")
      .select(
        "id,subject_template,description_template,business_domain,project_id,property_id,default_priority,default_status,create_day_of_month,due_day_of_month,start_date,end_date,is_active"
      )
      .order("created_at", { ascending: true }),
    supabase
      .from("project_dashboard_view")
      .select("id,name,customer_name")
      .order("updated_at", { ascending: false })
      .range(0, 999),
    supabase
      .from("properties")
      .select("id,address,is_active")
      .order("address", { ascending: true })
      .range(0, 999),
    supabase
      .from("users")
      .select("id,full_name,email,active")
      // Task pickers only offer workers with system access (no payroll-only workers).
      .neq("role", "worker_no_access")
      .order("full_name", { ascending: true })
      .range(0, 499),
  ]);

  const missingSchema = Boolean(
    templatesResult.error?.message && looksLikeMissingSchema(templatesResult.error.message)
  );

  const assigneesResult =
    missingSchema || (templatesResult.data ?? []).length === 0
      ? { data: [], error: null }
      : await supabase
          .from("recurring_task_template_assignees")
          .select("recurring_task_template_id,user_id")
          .in(
            "recurring_task_template_id",
            ((templatesResult.data ?? []) as Row[])
              .map((row) => getString(row, "id"))
              .filter((value): value is string => Boolean(value))
          );

  const loadError =
    missingSchema
      ? null
      : templatesResult.error?.message ??
        assigneesResult.error?.message ??
        projectsResult.error?.message ??
        propertiesResult.error?.message ??
        usersResult.error?.message ??
        null;

  const assigneeMap = new Map<string, string[]>();
  ((assigneesResult.data ?? []) as Row[]).forEach((row) => {
    const templateId = getString(row, "recurring_task_template_id");
    const userId = getString(row, "user_id");
    if (!templateId || !userId) return;
    const current = assigneeMap.get(templateId) ?? [];
    current.push(userId);
    assigneeMap.set(templateId, current);
  });

  const templates = ((templatesResult.data ?? []) as Row[]).map((row) => {
    const id = getString(row, "id") ?? "";
    return {
      id,
      subject_template: getString(row, "subject_template") ?? "",
      description_template: getString(row, "description_template"),
      business_domain: getString(row, "business_domain") ?? "general_business",
      project_id: getString(row, "project_id"),
      property_id: getString(row, "property_id"),
      default_priority: normalizePriority(getString(row, "default_priority")),
      default_status: normalizeStatus(getString(row, "default_status")),
      create_day_of_month:
        typeof row.create_day_of_month === "number"
          ? row.create_day_of_month
          : Number(row.create_day_of_month ?? 1) || 1,
      due_day_of_month:
        typeof row.due_day_of_month === "number"
          ? row.due_day_of_month
          : Number(row.due_day_of_month ?? 1) || 1,
      start_date: getString(row, "start_date"),
      end_date: getString(row, "end_date"),
      is_active: row.is_active !== false,
      assignee_user_ids: assigneeMap.get(id) ?? [],
    };
  });

  const projectOptions = ((projectsResult.data ?? []) as Row[])
    .map((row) => {
      const id = getString(row, "id") ?? "";
      const name = getString(row, "name") ?? "";
      const customerName = getString(row, "customer_name");
      return {
        id,
        label: customerName ? `${name} (${customerName})` : name,
      };
    })
    .filter((row) => row.id && row.label);

  const propertyOptions = ((propertiesResult.data ?? []) as Row[])
    .filter((row) => row.is_active !== false)
    .map((row) => ({
      id: getString(row, "id") ?? "",
      label: getString(row, "address") ?? "",
    }))
    .filter((row) => row.id && row.label);

  const userOptions = ((usersResult.data ?? []) as Row[])
    .filter((row) => row.active !== false)
    .map((row) => ({
      id: getString(row, "id") ?? "",
      label: getString(row, "full_name") ?? getString(row, "email") ?? "",
    }))
    .filter((row) => row.id && row.label);

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <div className="space-y-4">
        <TasksTabs />
        {loadError ? (
          <Card>
            <CardContent className="py-6 text-sm text-destructive">
              {`שגיאה בטעינת משימות קבועות: ${loadError}`}
            </CardContent>
          </Card>
        ) : (
          <RecurringTasksClient
            templates={templates}
            projects={projectOptions}
            properties={propertyOptions}
            users={userOptions}
            missingSchema={missingSchema}
            hideHeader
          />
        )}
      </div>
    </AppShell>
  );
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { addWorkingDays } from "@/lib/dashboard/week";

type Row = Record<string, unknown>;

export type ProjectStatusKey = "planning" | "active" | "on_hold" | "completed";

export type ProjectNearDeadline = {
  id: string;
  name: string;
  customerName: string | null;
  endDate: string | null;
};

export type ProjectsOverview = {
  statusCounts: Record<ProjectStatusKey, number>;
  nearDeadline: ProjectNearDeadline[];
};

// Map the raw project.status values to the four dashboard buckets.
const STATUS_MAP: Record<string, ProjectStatusKey> = {
  planned: "planning",
  planning: "planning",
  quote: "planning",
  active: "active",
  in_progress: "active",
  on_hold: "on_hold",
  hold: "on_hold",
  completed: "completed",
  done: "completed",
};

function getString(row: Row, key: string) {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

/**
 * Project status breakdown + the projects whose end_date falls within the next 3
 * working days (Israeli week). Reads the base `projects` table so we get `end_date`
 * and `status` (the *_view layers don't expose end_date). Best-effort — failure
 * yields zeroed counts and an empty near-deadline list.
 */
export async function getProjectsOverview(
  supabase: SupabaseClient
): Promise<ProjectsOverview> {
  const statusCounts: Record<ProjectStatusKey, number> = {
    planning: 0,
    active: 0,
    on_hold: 0,
    completed: 0,
  };

  const { data, error } = await supabase
    .from("projects")
    .select("id,name,status,end_date,customer_id")
    .range(0, 999);

  if (error || !data) return { statusCounts, nearDeadline: [] };
  const rows = data as Row[];

  for (const row of rows) {
    const key = STATUS_MAP[(getString(row, "status") ?? "").toLowerCase()];
    if (key) statusCounts[key] += 1;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = today.toISOString().slice(0, 10);
  const horizonIso = addWorkingDays(today, 3).toISOString().slice(0, 10);

  const nearRows = rows.filter((row) => {
    const status = (getString(row, "status") ?? "").toLowerCase();
    if (STATUS_MAP[status] !== "active") return false;
    const end = getString(row, "end_date");
    return end !== null && end.slice(0, 10) >= todayIso && end.slice(0, 10) <= horizonIso;
  });

  const customerIds = [
    ...new Set(
      nearRows.map((r) => getString(r, "customer_id")).filter((v): v is string => Boolean(v))
    ),
  ];
  const customersRes = customerIds.length
    ? await supabase.from("customers").select("id,name").in("id", customerIds)
    : { data: [] as Row[] };
  const customerNameById = new Map(
    ((customersRes.data ?? []) as Row[])
      .map((r) => [getString(r, "id"), getString(r, "name")] as const)
      .filter((e): e is readonly [string, string | null] => Boolean(e[0]))
  );

  const nearDeadline: ProjectNearDeadline[] = nearRows
    .map((row) => {
      const customerId = getString(row, "customer_id");
      return {
        id: getString(row, "id") ?? "",
        name: getString(row, "name") ?? "פרויקט",
        customerName: customerId ? customerNameById.get(customerId) ?? null : null,
        endDate: getString(row, "end_date"),
      };
    })
    .filter((r) => r.id)
    .sort((a, b) => (a.endDate ?? "").localeCompare(b.endDate ?? ""));

  return { statusCounts, nearDeadline };
}

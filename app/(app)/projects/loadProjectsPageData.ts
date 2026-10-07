import type { SupabaseClient } from "@supabase/supabase-js";

// The /projects page's other reads, besides the list itself: the tab counts
// and the new-project dialog's customer and manager lists. Shared by the
// server page and its device version (LocalProjectsPage).

type Row = Record<string, unknown>;

export type ProjectsTabCounts = { projects: number; quotes: number; closed: number };

export type ProjectsCustomerOption = {
  id: string;
  label: string;
  phone: string | null;
  email: string | null;
  name_for_invoice: string | null;
};

export type ProjectsPickerOptions = {
  customerOptions: ProjectsCustomerOption[];
  managerOptions: Array<{ id: string; label: string }>;
  defaultProjectManagerId: string | null;
};

const OPTIONS_PAGE_SIZE = 50;

const CLOSED_STATUSES = ["quote", "completed"];

/**
 * The three tab counts. They only need status/customer_id, so they count the
 * plain projects table rather than project_dashboard_view (which forces a full
 * financials + task-progress aggregation per count).
 */
export async function loadProjectsTabCounts(supabase: SupabaseClient, customerId: string | null): Promise<ProjectsTabCounts> {
  const [projectsCountRes, quotesCountRes, closedCountRes] = await Promise.all([
    (() => {
      let q = supabase
        .from("projects")
        .select("id", { count: "estimated", head: true })
        .not("status", "in", `(${CLOSED_STATUSES.join(",")})`);
      if (customerId) q = q.eq("customer_id", customerId);
      return q;
    })(),
    (() => {
      let q = supabase.from("projects").select("id", { count: "estimated", head: true }).eq("status", "quote");
      if (customerId) q = q.eq("customer_id", customerId);
      return q;
    })(),
    (() => {
      let q = supabase.from("projects").select("id", { count: "estimated", head: true }).eq("status", "completed");
      if (customerId) q = q.eq("customer_id", customerId);
      return q;
    })(),
  ]);
  return {
    projects: typeof projectsCountRes.count === "number" ? projectsCountRes.count : 0,
    quotes: typeof quotesCountRes.count === "number" ? quotesCountRes.count : 0,
    closed: typeof closedCountRes.count === "number" ? closedCountRes.count : 0,
  };
}

/** The new-project dialog's first customers and the project managers to pick from. */
export async function loadProjectsPickerOptions(supabase: SupabaseClient): Promise<ProjectsPickerOptions> {
  const [{ data: users }, { data: customers }] = await Promise.all([
    supabase
      .from("users")
      .select("id,full_name,email,active")
      .order("full_name", { ascending: true })
      // Same names (or none) in one order everywhere — the device's too.
      .order("id")
      .range(0, OPTIONS_PAGE_SIZE - 1),
    // Straight from customers: customer_overview_view would total every
    // customer's orders, projects and payments just to name 50 of them.
    supabase
      .from("customers")
      .select("id,name,name_for_invoice,phone,email")
      .order("name", { ascending: true })
      .order("id")
      .range(0, OPTIONS_PAGE_SIZE - 1),
  ]);

  // Same values customer_overview_view gave: trimmed, blanks as null, and the
  // name falling back to the invoice name, then "לקוח".
  const trimmed = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
  const customerOptions = ((customers ?? []) as Row[])
    .map((row) => {
      const id = typeof row?.id === "string" ? row.id : "";
      const name_for_invoice = trimmed(row?.name_for_invoice);
      const label = trimmed(row?.name) ?? name_for_invoice ?? "לקוח";
      return { id, label, phone: trimmed(row?.phone), email: trimmed(row?.email), name_for_invoice };
    })
    .filter((row) => row.id && row.label);

  const managerOptions = ((users ?? []) as Row[])
    .map((row) => {
      const fullName = typeof row?.full_name === "string" && row.full_name.trim() ? row.full_name.trim() : null;
      const email = typeof row?.email === "string" && row.email.trim() ? row.email.trim() : null;
      return {
        id: typeof row?.id === "string" ? row.id : "",
        label: fullName ?? email ?? "",
        active: row?.active,
      };
    })
    .filter((row) => row.id && row.label && row.active !== false)
    .map((row) => ({ id: row.id, label: row.label }));

  // Keep only Hebrew base letters (U+05D0–U+05EA) for a robust substring match
  // that tolerates nikud, diacritics, invisible unicode, and spacing differences.
  const hebrewLettersOnly = (s: string) => s.replace(/[^א-ת]/g, "");
  const defaultProjectManagerId =
    managerOptions.find((m) => hebrewLettersOnly(m.label).includes(hebrewLettersOnly("הלר")))?.id ?? null;

  return { customerOptions, managerOptions, defaultProjectManagerId };
}

/** The customer list plus the customers of the rows on screen (deduplicated by id). */
export function withListCustomers(customerOptions: ProjectsCustomerOption[], rows: Row[]): ProjectsCustomerOption[] {
  const fromRows = rows
    .map((row) => ({
      id: typeof row?.customer_id === "string" ? row.customer_id : "",
      label: typeof row?.customer_name === "string" && row.customer_name.trim() ? row.customer_name : "",
      phone: null,
      email: null,
      name_for_invoice: null,
    }))
    .filter((row) => row.id && row.label);
  return Array.from(new Map([...customerOptions, ...fromRows].map((row) => [row.id, row])).values());
}

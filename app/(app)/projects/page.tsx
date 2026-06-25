import { requireProfile } from "@/lib/auth/requireProfile";
import AppShell from "@/components/layout/AppShell";
import ProjectsClient from "@/app/(app)/projects/ProjectsClient";
import {
  loadProjectsPage,
  type ProjectsSort,
  type ProjectsView,
} from "@/app/(app)/projects/loadProjects";

type Row = Record<string, unknown>;

const OPTIONS_PAGE_SIZE = 50;

function parseView(value: string | undefined): ProjectsView {
  return value === "quotes" || value === "closed" ? value : "projects";
}

function parseSort(value: string | undefined, view: ProjectsView): ProjectsSort {
  if (value === "recent" || value === "start_date" || value === "start_date_desc" || value === "profit_desc") {
    return value;
  }
  return view === "closed" ? "start_date_desc" : "start_date";
}

const CLOSED_STATUSES = ["quote", "completed"];

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams?: Promise<{
    customer_id?: string;
    customer_name?: string;
    view?: string;
    status?: string;
    sort?: string;
    q?: string;
  }>;
}) {
  const params = (await searchParams) ?? {};
  const customerId =
    typeof params.customer_id === "string" && params.customer_id.trim()
      ? params.customer_id.trim()
      : null;
  const customerName =
    typeof params.customer_name === "string" && params.customer_name.trim()
      ? params.customer_name.trim()
      : null;
  const view = parseView(params.view);
  const statusFilter = typeof params.status === "string" && params.status.trim() ? params.status.trim() : "all";
  const sort = parseSort(params.sort, view);
  const searchQuery = typeof params.q === "string" ? params.q.trim() : "";

  const { profile, supabase } = await requireProfile();

  const filters = { view, status: statusFilter, customerId, sort, q: searchQuery };

  const [
    projectsResult,
    { data: users },
    { data: customers },
    projectsCountRes,
    quotesCountRes,
    closedCountRes,
  ] = await Promise.all([
    loadProjectsPage(supabase, { page: 1, filters }),
    supabase
      .from("users")
      .select("id,full_name,email,active")
      .order("full_name", { ascending: true })
      .range(0, OPTIONS_PAGE_SIZE - 1),
    supabase
      .from("customer_overview_view")
      .select("customer_id,customer_name,name_for_invoice,phone,email")
      .order("customer_name", { ascending: true })
      .range(0, OPTIONS_PAGE_SIZE - 1),
    // Tab counts — folded into this batch so they run concurrently instead of as
    // a second sequential round-trip wave.
    (() => {
      let q = supabase
        .from("project_dashboard_view")
        .select("id", { count: "estimated", head: true })
        .not("status", "in", `(${CLOSED_STATUSES.join(",")})`);
      if (customerId) q = q.eq("customer_id", customerId);
      return q;
    })(),
    (() => {
      let q = supabase
        .from("project_dashboard_view")
        .select("id", { count: "estimated", head: true })
        .eq("status", "quote");
      if (customerId) q = q.eq("customer_id", customerId);
      return q;
    })(),
    (() => {
      let q = supabase
        .from("project_dashboard_view")
        .select("id", { count: "estimated", head: true })
        .eq("status", "completed");
      if (customerId) q = q.eq("customer_id", customerId);
      return q;
    })(),
  ]);

  const rowsWithPaymentStatus = projectsResult.rows;
  const loadError = projectsResult.error;

  const customerOptions = ((customers ?? []) as Row[])
    .map((row) => {
      const id = typeof row?.customer_id === "string" ? row.customer_id : "";
      const label = typeof row?.customer_name === "string" ? row.customer_name.trim() : "";
      const phone = typeof row?.phone === "string" ? row.phone : null;
      const email = typeof row?.email === "string" ? row.email : null;
      const name_for_invoice = typeof row?.name_for_invoice === "string" ? row.name_for_invoice : null;
      return { id, label, phone, email, name_for_invoice };
    })
    .filter((row: { id: string; label: string }) => row.id && row.label);

  const fallbackCustomers = rowsWithPaymentStatus
    .map((row: Row) => ({
      id: typeof row?.customer_id === "string" ? row.customer_id : "",
      label:
        typeof row?.customer_name === "string" && row.customer_name.trim() ? row.customer_name : "",
      phone: null,
      email: null,
      name_for_invoice: null,
    }))
    .filter((row: { id: string; label: string }) => row.id && row.label);

  const customerOptionsFinal = Array.from(
    new Map([...customerOptions, ...fallbackCustomers].map((row) => [row.id, row])).values()
  );

  const managerOptions = ((users ?? []) as Row[])
    .map((row) => {
      const fullName =
        typeof row?.full_name === "string" && row.full_name.trim() ? row.full_name.trim() : null;
      const email = typeof row?.email === "string" && row.email.trim() ? row.email.trim() : null;
      return {
        id: typeof row?.id === "string" ? row.id : "",
        label: fullName ?? email ?? "",
        active: row?.active,
      };
    })
    .filter(
      (row: { id: string; label: string; active: unknown }) =>
        row.id && row.label && row.active !== false
    )
    .map((row: { id: string; label: string }) => ({ id: row.id, label: row.label }));

  // Keep only Hebrew base letters (U+05D0–U+05EA) for a robust substring match
  // that tolerates nikud, diacritics, invisible unicode, and spacing differences.
  const hebrewLettersOnly = (s: string) => s.replace(/[^א-ת]/g, "");
  const defaultProjectManagerId =
    managerOptions.find((m) => hebrewLettersOnly(m.label).includes(hebrewLettersOnly("הלר")))?.id ?? null;

  const totalCount = projectsResult.totalCount;
  const hasMore = projectsResult.hasMore;

  const tabCounts = {
    projects: typeof projectsCountRes.count === "number" ? projectsCountRes.count : 0,
    quotes: typeof quotesCountRes.count === "number" ? quotesCountRes.count : 0,
    closed: typeof closedCountRes.count === "number" ? closedCountRes.count : 0,
  };

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <div className="space-y-4">
        {customerName ? (
          <div className="text-lg font-medium">לקוח: {customerName}</div>
        ) : null}

        {loadError ? (
          <div className="text-destructive text-sm">שגיאה בטעינת פרויקטים: {loadError}</div>
        ) : (
          <ProjectsClient
            initialProjects={rowsWithPaymentStatus}
            initialHasMore={hasMore}
            totalCount={totalCount}
            customerOptions={customerOptionsFinal}
            managerOptions={managerOptions}
            currentUserId={profile.id}
            viewerRole={profile.role}
            defaultProjectManagerId={defaultProjectManagerId ?? undefined}
            tabCounts={tabCounts}
            initialFilters={{ view, status: statusFilter, customerId, sort, q: searchQuery }}
          />
        )}
      </div>
    </AppShell>
  );
}


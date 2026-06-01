import Link from "next/link";
import { requireProfile } from "@/lib/auth/requireProfile";
import AppShell from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import ProjectsClient from "@/app/projects/ProjectsClient";

type Row = Record<string, unknown>;

const PROJECTS_PAGE_SIZE = 50;
const OPTIONS_PAGE_SIZE = 50;

function parsePage(value: string | undefined) {
  const page = Number(value ?? "1");
  return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
}

function toNumber(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

type ProjectsView = "projects" | "quotes" | "closed";
type ProjectsSort = "recent" | "start_date" | "start_date_desc" | "profit_desc";

function parseView(value: string | undefined): ProjectsView {
  return value === "quotes" || value === "closed" ? value : "projects";
}

function parseSort(value: string | undefined, view: ProjectsView): ProjectsSort {
  if (value === "recent" || value === "start_date" || value === "start_date_desc" || value === "profit_desc") {
    return value;
  }
  return view === "closed" ? "start_date_desc" : "start_date";
}

function buildProjectsHref(
  page: number,
  customerId: string | null,
  customerName: string | null,
  customerPage: string | null,
  view: ProjectsView,
  status: string,
  sort: ProjectsSort,
  q: string
) {
  const params = new URLSearchParams();
  if (customerId) params.set("customer_id", customerId);
  if (customerName) params.set("customer_name", customerName);
  if (customerPage) params.set("customer_page", customerPage);
  if (view !== "projects") params.set("view", view);
  if (status && status !== "all") params.set("status", status);
  if (sort !== (view === "closed" ? "start_date_desc" : "start_date")) params.set("sort", sort);
  if (q.trim()) params.set("q", q.trim());
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/projects?${query}` : "/projects";
}

const CLOSED_STATUSES = ["quote", "completed"];

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams?: Promise<{
    page?: string;
    customer_id?: string;
    customer_name?: string;
    customer_page?: string;
    view?: string;
    status?: string;
    sort?: string;
    q?: string;
  }>;
}) {
  const params = (await searchParams) ?? {};
  const page = parsePage(params.page);
  const customerId =
    typeof params.customer_id === "string" && params.customer_id.trim()
      ? params.customer_id.trim()
      : null;
  const customerName =
    typeof params.customer_name === "string" && params.customer_name.trim()
      ? params.customer_name.trim()
      : null;
  const customerPage =
    typeof params.customer_page === "string" && params.customer_page.trim()
      ? params.customer_page.trim()
      : null;
  const view = parseView(params.view);
  const statusFilter = typeof params.status === "string" && params.status.trim() ? params.status.trim() : "all";
  const sort = parseSort(params.sort, view);
  const searchQuery = typeof params.q === "string" ? params.q.trim() : "";
  const from = (page - 1) * PROJECTS_PAGE_SIZE;
  const to = page * PROJECTS_PAGE_SIZE - 1;

  const { profile, supabase } = await requireProfile();

  const [
    { data, error, count },
    { data: users },
    { data: customers },
  ] = await Promise.all([
    (() => {
      let query = supabase
        .from("project_dashboard_view")
        .select(
          "id,name,status,project_type,start_date,end_date,agreed_base_price,actual_price,customer_id,customer_name,project_manager_id,project_manager_name,created_at,updated_at,total_expenses,gross_profit,total_tasks,completed_tasks,open_tasks",
          { count: "estimated" }
        );

      if (view === "quotes") {
        query = query.eq("status", "quote");
      } else if (view === "closed") {
        query = query.eq("status", "completed");
      } else {
        query = query.not("status", "in", `(${CLOSED_STATUSES.join(",")})`);
      }

      if (statusFilter !== "all") query = query.eq("status", statusFilter);
      if (customerId) query = query.eq("customer_id", customerId);
      if (searchQuery) {
        const escaped = searchQuery.replace(/[%,]/g, " ");
        query = query.or(`name.ilike.%${escaped}%,customer_name.ilike.%${escaped}%`);
      }

      if (sort === "profit_desc") {
        query = query.order("gross_profit", { ascending: false, nullsFirst: false });
      } else if (sort === "start_date_desc") {
        query = query.order("start_date", { ascending: false, nullsFirst: false });
      } else if (sort === "start_date") {
        query = query.order("start_date", { ascending: true, nullsFirst: false });
      } else {
        query = query.order("updated_at", { ascending: false });
      }

      return query.range(from, to);
    })(),
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
  ]);

  const rows = (data ?? []) as Row[];
  const projectIds = rows
    .map((row) => (typeof row?.id === "string" ? row.id : ""))
    .filter(Boolean);

  const projectCustomerIds = [...new Set(rows.map((row) => (typeof row?.customer_id === "string" ? row.customer_id : "")).filter(Boolean))];

  const [{ data: projectSettingsRows }] = await Promise.all([
    projectIds.length > 0
      ? supabase.from("projects").select("id,expenses_billed_separately").in("id", projectIds)
      : Promise.resolve({ data: [] as Row[] }),
  ]);

  const [{ data: financialRows }, { data: projectContacts }] = await Promise.all([
    projectIds.length > 0
      ? supabase
          .from("project_financials_view")
          .select("id,total_expenses,gross_profit,customer_total_price,expenses_billed,collected_amount")
          .in("id", projectIds)
      : Promise.resolve({ data: [] as Row[] }),
    projectCustomerIds.length > 0
      ? supabase.from("contacts").select("customer_id,full_name,phone,email,whatsapp").in("customer_id", projectCustomerIds).eq("active", true)
      : Promise.resolve({ data: [] as Row[] }),
  ]);

  const expensesSeparatelyByProjectId = new Map<string, boolean>();
  ((projectSettingsRows ?? []) as Row[]).forEach((row) => {
    const projectId = typeof row?.id === "string" ? row.id : "";
    if (!projectId) return;
    expensesSeparatelyByProjectId.set(projectId, row?.expenses_billed_separately === true);
  });

  const financialByProjectId = new Map<string, Row>();
  ((financialRows ?? []) as Row[]).forEach((row) => {
    const projectId = typeof row?.id === "string" ? row.id : "";
    if (!projectId) return;
    financialByProjectId.set(projectId, row);
  });

  const rowsWithPaymentStatus = rows.map((row) => {
    const projectId = typeof row?.id === "string" ? row.id : "";
    const financialRow = financialByProjectId.get(projectId) ?? null;
    const actualPrice = toNumber(row?.actual_price);
    const agreedBasePrice = toNumber(row?.agreed_base_price);
    const totalExpenses =
      toNumber(financialRow?.total_expenses) ?? toNumber(row?.total_expenses) ?? 0;
    const grossProfit =
      toNumber(financialRow?.gross_profit) ?? toNumber(row?.gross_profit) ?? null;
    const expensesBilled = toNumber(financialRow?.expenses_billed) ?? 0;
    const baseProjectPrice = agreedBasePrice ?? actualPrice ?? 0;
    const derivedCustomerTotalPrice = baseProjectPrice + expensesBilled;
    const customerTotalPrice =
      derivedCustomerTotalPrice > 0
        ? derivedCustomerTotalPrice
        : toNumber(financialRow?.customer_total_price) ?? 0;
    const paidTotal = toNumber(financialRow?.collected_amount) ?? 0;
    const expensesBilledSeparately = expensesSeparatelyByProjectId.get(projectId) ?? false;
    const amountDue = customerTotalPrice;
    const priceUnset = baseProjectPrice <= 0;

    const paymentStatus =
      priceUnset
        ? "unpriced"
        : amountDue <= 0 || paidTotal >= amountDue
        ? "paid"
        : paidTotal > 0
          ? "partial"
          : "unpaid";

    return {
      ...row,
      total_expenses: totalExpenses,
      gross_profit: grossProfit,
      customer_total_price: customerTotalPrice,
      expenses_billed_separately: expensesBilledSeparately,
      paid_total: paidTotal,
      amount_due: amountDue,
      payment_status_list: paymentStatus,
    };
  });

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

  const fallbackCustomers = rows
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

  const totalCount = typeof count === "number" ? count : rows.length;
  const hasPreviousPage = page > 1;
  const hasNextPage = typeof count === "number" ? to + 1 < count : rows.length === PROJECTS_PAGE_SIZE;

  const tabCountQueries = await Promise.all([
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
  const tabCounts = {
    projects: typeof tabCountQueries[0].count === "number" ? tabCountQueries[0].count : 0,
    quotes: typeof tabCountQueries[1].count === "number" ? tabCountQueries[1].count : 0,
    closed: typeof tabCountQueries[2].count === "number" ? tabCountQueries[2].count : 0,
  };

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <div className="space-y-4">
        {customerName ? (
          <div className="text-lg font-medium">לקוח: {customerName}</div>
        ) : null}

        {error ? (
          <div className="text-destructive text-sm">שגיאה בטעינת פרויקטים: {error.message}</div>
        ) : (
          <>
            <ProjectsClient
              initialProjects={rowsWithPaymentStatus}
              customerOptions={customerOptionsFinal}
              managerOptions={managerOptions}
              currentUserId={profile.id}
              defaultProjectManagerId={defaultProjectManagerId ?? undefined}
              contacts={(projectContacts ?? []) as Row[]}
              tabCounts={tabCounts}
              initialFilters={{ view, status: statusFilter, sort, q: searchQuery }}
            />
            <div className="flex items-center justify-between gap-3 border-t pt-4 text-sm">
              <div className="text-muted-foreground">
                עמוד {page} • מציגים {rows.length} מתוך {totalCount}
              </div>
              <div className="flex gap-2">
                {hasPreviousPage ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={buildProjectsHref(page - 1, customerId, customerName, customerPage, view, statusFilter, sort, searchQuery)}>
                      הקודם
                    </Link>
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" disabled>
                    הקודם
                  </Button>
                )}
                {hasNextPage ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={buildProjectsHref(page + 1, customerId, customerName, customerPage, view, statusFilter, sort, searchQuery)}>
                      הבא
                    </Link>
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" disabled>
                    הבא
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}


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

function buildCustomerReturnHref(
  customerId: string | null,
  customerName: string | null,
  customerPage: string | null
) {
  if (!customerId) return "/customers";
  const params = new URLSearchParams({ customer_id: customerId });
  if (customerName) params.set("customer_name", customerName);
  if (customerPage) params.set("page", customerPage);
  return `/customers?${params.toString()}`;
}

function buildProjectsHref(
  page: number,
  customerId: string | null,
  customerName: string | null,
  customerPage: string | null
) {
  const params = new URLSearchParams();
  if (customerId) params.set("customer_id", customerId);
  if (customerName) params.set("customer_name", customerName);
  if (customerPage) params.set("customer_page", customerPage);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/projects?${query}` : "/projects";
}

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams?: Promise<{
    page?: string;
    customer_id?: string;
    customer_name?: string;
    customer_page?: string;
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
        )
        .order("updated_at", { ascending: false });
      if (customerId) query = query.eq("customer_id", customerId);
      return query.range(from, to);
    })(),
    supabase
      .from("users")
      .select("id,full_name,email,active")
      .order("full_name", { ascending: true })
      .range(0, OPTIONS_PAGE_SIZE - 1),
    supabase
      .from("customer_overview_view")
      .select("customer_id,customer_name,phone,email")
      .order("customer_name", { ascending: true })
      .range(0, OPTIONS_PAGE_SIZE - 1),
  ]);

  const rows = (data ?? []) as Row[];
  const projectIds = rows
    .map((row) => (typeof row?.id === "string" ? row.id : ""))
    .filter(Boolean);

  const [{ data: paymentRows }, { data: projectSettingsRows }] = await Promise.all([
    projectIds.length > 0
      ? supabase.from("payments").select("project_id,amount_total").in("project_id", projectIds)
      : Promise.resolve({ data: [], error: null }),
    projectIds.length > 0
      ? supabase.from("projects").select("id,expenses_billed_separately").in("id", projectIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const { data: financialRows } =
    projectIds.length > 0
      ? await supabase
          .from("project_financials_view")
          .select("id,total_expenses,gross_profit,customer_total_price,expenses_billed")
          .in("id", projectIds)
      : { data: [] as Row[], error: null };

  const paidTotalByProjectId = new Map<string, number>();
  ((paymentRows ?? []) as Row[]).forEach((row) => {
    const projectId = typeof row?.project_id === "string" ? row.project_id : "";
    if (!projectId) return;
    const amount = toNumber(row?.amount_total) ?? 0;
    paidTotalByProjectId.set(projectId, (paidTotalByProjectId.get(projectId) ?? 0) + amount);
  });

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
    const paidTotal = paidTotalByProjectId.get(projectId) ?? 0;
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
      return { id, label, phone, email };
    })
    .filter((row: { id: string; label: string }) => row.id && row.label);

  const fallbackCustomers = rows
    .map((row: Row) => ({
      id: typeof row?.customer_id === "string" ? row.customer_id : "",
      label:
        typeof row?.customer_name === "string" && row.customer_name.trim() ? row.customer_name : "",
      phone: null,
      email: null,
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

  const totalCount = typeof count === "number" ? count : rows.length;
  const hasPreviousPage = page > 1;
  const hasNextPage = typeof count === "number" ? to + 1 < count : rows.length === PROJECTS_PAGE_SIZE;

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined}>
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">פרויקטים</h1>
            {customerName ? <div className="text-lg font-medium">לקוח: {customerName}</div> : null}
            <p className="text-muted-foreground text-sm">ניהול פרויקטים ותפעול</p>
          </div>
          {customerId ? (
            <Button asChild variant="outline" size="sm">
              <Link href={buildCustomerReturnHref(customerId, customerName, customerPage)}>חזרה ללקוח</Link>
            </Button>
          ) : null}
        </div>

        {error ? (
          <div className="text-destructive text-sm">שגיאה בטעינת פרויקטים: {error.message}</div>
        ) : (
          <>
            <ProjectsClient
              initialProjects={rowsWithPaymentStatus}
              customerOptions={customerOptionsFinal}
              managerOptions={managerOptions}
              currentUserId={profile.id}
            />
            <div className="flex items-center justify-between gap-3 border-t pt-4 text-sm">
              <div className="text-muted-foreground">
                עמוד {page} • מציגים {rows.length} מתוך {totalCount}
              </div>
              <div className="flex gap-2">
                {hasPreviousPage ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={buildProjectsHref(page - 1, customerId, customerName, customerPage)}>
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
                    <Link href={buildProjectsHref(page + 1, customerId, customerName, customerPage)}>
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


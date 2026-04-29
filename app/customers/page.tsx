import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { requireProfile } from "@/lib/auth/requireProfile";
import CustomersClient from "@/app/customers/CustomersClient";

type Row = Record<string, unknown>;

const PAGE_SIZE = 50;

function toNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toDateValue(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parsePage(value: string | undefined) {
  const page = Number(value ?? "1");
  return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
}

function buildPageHref(page: number) {
  return page <= 1 ? "/customers" : `/customers?page=${page}`;
}

function rowId(row: Row) {
  const customerId = typeof row?.customer_id === "string" ? row.customer_id : null;
  if (customerId && customerId.trim()) return customerId.trim();
  const id = typeof row?.id === "string" ? row.id : null;
  if (id && id.trim()) return id.trim();
  return "";
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams?: Promise<{ page?: string; customer_id?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const page = parsePage(params.page);
  const from = (page - 1) * PAGE_SIZE;
  const to = page * PAGE_SIZE - 1;

  const { profile, supabase } = await requireProfile();

  const { data: overviewRows, error: overviewError, count } = await supabase
    .from("customer_overview_view")
    .select(
      "customer_id,customer_name,email,phone,orders_count,projects_count,total_sales,total_paid,open_balance,last_order_at,last_payment_at,address,active,notes,name_for_invoice,registration_number",
      { count: "estimated" }
    )
    .order("customer_name", { ascending: true })
    .range(from, to);

  const customerIds = ((overviewRows ?? []) as Row[])
    .map((row) => rowId(row))
    .filter(Boolean);

  const { data: customerRows, error: customerRowsError } = customerIds.length
    ? await supabase
        .from("customers")
        .select("id,whatsapp")
        .in("id", customerIds)
    : { data: [], error: null };

  const { data: projectRows, error: projectRowsError } = customerIds.length
    ? await supabase
        .from("projects")
        .select("id,customer_id,agreed_base_price,actual_price")
        .in("customer_id", customerIds)
    : { data: [], error: null };

  const projectIds = ((projectRows ?? []) as Row[])
    .map((row) => (typeof row?.id === "string" ? row.id : ""))
    .filter(Boolean);

  const [{ data: projectFinancialRows, error: projectFinancialError }, { data: projectPaymentRows, error: projectPaymentError }] =
    projectIds.length
      ? await Promise.all([
          supabase
            .from("project_financials_view")
            .select("id,customer_total_price,expenses_billed")
            .in("id", projectIds),
          supabase
            .from("payments")
            .select("project_id,amount_total,payment_date")
            .in("project_id", projectIds),
        ])
      : [{ data: [], error: null }, { data: [], error: null }];

  const customerById = new Map<string, Row>();
  ((customerRows ?? []) as Row[]).forEach((row) => {
    const id = typeof row?.id === "string" ? row.id.trim() : "";
    if (!id) return;
    customerById.set(id, row);
  });

  const financialByProjectId = new Map<string, Row>();
  ((projectFinancialRows ?? []) as Row[]).forEach((row) => {
    const id = typeof row?.id === "string" ? row.id.trim() : "";
    if (!id) return;
    financialByProjectId.set(id, row);
  });

  const projectPaidTotalsByProjectId = new Map<string, number>();
  const projectLastPaymentByProjectId = new Map<string, string>();
  ((projectPaymentRows ?? []) as Row[]).forEach((row) => {
    const projectId = typeof row?.project_id === "string" ? row.project_id.trim() : "";
    if (!projectId) return;
    const amount = toNumber(row?.amount_total);
    projectPaidTotalsByProjectId.set(projectId, (projectPaidTotalsByProjectId.get(projectId) ?? 0) + amount);
    const paymentDate = typeof row?.payment_date === "string" ? row.payment_date.trim() : "";
    if (!paymentDate) return;
    const current = projectLastPaymentByProjectId.get(projectId) ?? "";
    if (!current || paymentDate > current) {
      projectLastPaymentByProjectId.set(projectId, paymentDate);
    }
  });

  const projectTotalsByCustomerId = new Map<string, { totalSales: number; totalPaid: number; lastPaymentAt: string | null }>();
  ((projectRows ?? []) as Row[]).forEach((row) => {
    const customerId = typeof row?.customer_id === "string" ? row.customer_id.trim() : "";
    const projectId = typeof row?.id === "string" ? row.id.trim() : "";
    if (!customerId || !projectId) return;

    const financialRow = financialByProjectId.get(projectId);
    const actualPrice = toNumber(row?.actual_price);
    const agreedBasePrice = toNumber(row?.agreed_base_price);
    const expensesBilled = toNumber(financialRow?.expenses_billed);
    const fallbackTotal =
      (actualPrice > 0 ? actualPrice : agreedBasePrice > 0 ? agreedBasePrice : 0) + expensesBilled;
    const customerTotalPrice = Math.max(
      toNumber(financialRow?.customer_total_price),
      fallbackTotal
    );
    const paidTotal = projectPaidTotalsByProjectId.get(projectId) ?? 0;
    const lastPaymentAt = projectLastPaymentByProjectId.get(projectId) ?? null;

    const current = projectTotalsByCustomerId.get(customerId) ?? {
      totalSales: 0,
      totalPaid: 0,
      lastPaymentAt: null,
    };

    const nextLastPaymentAt =
      lastPaymentAt && (!current.lastPaymentAt || toDateValue(lastPaymentAt) > toDateValue(current.lastPaymentAt))
        ? lastPaymentAt
        : current.lastPaymentAt;

    projectTotalsByCustomerId.set(customerId, {
      totalSales: current.totalSales + customerTotalPrice,
      totalPaid: current.totalPaid + paidTotal,
      lastPaymentAt: nextLastPaymentAt,
    });
  });

  const { data: contactRows, error: contactsError } = customerIds.length
    ? await supabase
        .from("contacts")
        .select("id,customer_id,full_name,role,phone,email,whatsapp,is_primary,active,notes")
        .in("customer_id", customerIds)
        .order("is_primary", { ascending: false })
        .order("full_name", { ascending: true })
    : { data: [], error: null };

  const contactsByCustomerId = new Map<string, Row[]>();
  ((contactRows ?? []) as Row[]).forEach((row) => {
    const customerId = typeof row?.customer_id === "string" ? row.customer_id.trim() : "";
    if (!customerId) return;
    const list = contactsByCustomerId.get(customerId) ?? [];
    list.push(row);
    contactsByCustomerId.set(customerId, list);
  });

  const rowsWithContacts = ((overviewRows ?? []) as Row[]).map((row) => {
    const id = rowId(row);
    const customer = customerById.get(id);
    const projectTotals = projectTotalsByCustomerId.get(id);
    const totalSales = toNumber(row.total_sales) + (projectTotals?.totalSales ?? 0);
    const totalPaid = toNumber(row.total_paid) + (projectTotals?.totalPaid ?? 0);
    const overviewLastPaymentAt = typeof row?.last_payment_at === "string" ? row.last_payment_at : null;
    const projectLastPaymentAt = projectTotals?.lastPaymentAt ?? null;
    const lastPaymentAt =
      projectLastPaymentAt && (!overviewLastPaymentAt || toDateValue(projectLastPaymentAt) > toDateValue(overviewLastPaymentAt))
        ? projectLastPaymentAt
        : overviewLastPaymentAt;

    return {
      ...row,
      total_sales: totalSales,
      total_paid: totalPaid,
      open_balance: Math.max(totalSales - totalPaid, 0),
      last_payment_at: lastPaymentAt,
      whatsapp: typeof customer?.whatsapp === "string" ? customer.whatsapp : null,
      contacts: contactsByCustomerId.get(id) ?? [],
    };
  });

  const loadError =
    overviewError?.message ??
    contactsError?.message ??
    customerRowsError?.message ??
    projectRowsError?.message ??
    projectFinancialError?.message ??
    projectPaymentError?.message ??
    null;
  const totalCount = typeof count === "number" ? count : rowsWithContacts.length;
  const hasPreviousPage = page > 1;
  const hasNextPage = typeof count === "number" ? to + 1 < count : rowsWithContacts.length === PAGE_SIZE;

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined}>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">לקוחות</h1>
          <p className="text-sm text-muted-foreground">
            כרטיסי לקוחות עם סיכומים, יתרות, אנשי קשר ופעולות מהירות.
          </p>
        </div>

        {loadError ? (
          <p className="text-sm text-destructive">שגיאה בטעינת לקוחות: {loadError}</p>
        ) : (
          <>
            <CustomersClient
              initialRows={rowsWithContacts}
              initialDetailsCustomerId={
                typeof params.customer_id === "string" && params.customer_id.trim()
                  ? params.customer_id.trim()
                  : ""
              }
            />
            <div className="flex items-center justify-between gap-3 border-t pt-4 text-sm">
              <div className="text-muted-foreground">
                עמוד {page} • מוצגים {rowsWithContacts.length} מתוך {totalCount}
              </div>
              <div className="flex gap-2">
                {hasPreviousPage ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={buildPageHref(page - 1)}>הקודם</Link>
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" disabled>
                    הקודם
                  </Button>
                )}
                {hasNextPage ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={buildPageHref(page + 1)}>הבא</Link>
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

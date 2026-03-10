import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import CustomersClient from "@/app/customers/CustomersClient";

type Row = Record<string, unknown>;

function rowId(row: Row) {
  const customerId = typeof row?.customer_id === "string" ? row.customer_id : null;
  if (customerId && customerId.trim()) return customerId.trim();
  const id = typeof row?.id === "string" ? row.id : null;
  if (id && id.trim()) return id.trim();
  return "";
}

export default async function CustomersPage() {
  const { profile, supabase } = await requireProfile();

  const [
    { data: overviewRows, error: overviewError },
    { data: customerRows, error: customersError },
    { data: activityRows, error: activityError },
    { data: openBalanceRows, error: openBalanceError },
    { data: ordersRows, error: ordersError },
    { data: projectsRows, error: projectsError },
    { data: salesSummaryRows, error: salesSummaryError },
  ] = await Promise.all([
    supabase.from("customer_overview_view").select("*").limit(5000),
    supabase
      .from("customers")
      .select("id,name,name_for_invoice,registration_number,phone,email,address,active,notes")
      .limit(5000),
    supabase.from("customer_activity_view").select("*").limit(5000),
    supabase.from("customer_open_balance_view").select("*").limit(5000),
    supabase.from("customer_orders_view").select("*").limit(5000),
    supabase.from("customer_projects_view").select("*").limit(5000),
    supabase.from("customer_sales_summary_view").select("*").limit(5000),
  ]);

  const { data: contactRows, error: contactsError } = await supabase
    .from("contacts")
    .select("*")
    .limit(10000);

  const overview = (overviewRows ?? []) as Row[];
  const customers = (customerRows ?? []) as Row[];
  const contacts = (contactRows ?? []) as Row[];
  const activity = (activityRows ?? []) as Row[];
  const openBalance = (openBalanceRows ?? []) as Row[];
  const orders = (ordersRows ?? []) as Row[];
  const projects = (projectsRows ?? []) as Row[];
  const salesSummary = (salesSummaryRows ?? []) as Row[];

  const customersById = new Map<string, Row>();
  customers.forEach((row) => {
    const id = typeof row?.id === "string" ? row.id : "";
    if (id) customersById.set(id, row);
  });

  const mergedByCustomerId = new Map<string, Row>();
  function mergeRows(list: Row[]) {
    list.forEach((row) => {
      const id = rowId(row);
      if (!id) return;
      const prev = mergedByCustomerId.get(id) ?? {};
      mergedByCustomerId.set(id, { ...prev, ...row, customer_id: id });
    });
  }

  mergeRows(overview);
  mergeRows(activity);
  mergeRows(openBalance);
  mergeRows(orders);
  mergeRows(projects);
  mergeRows(salesSummary);

  const merged = Array.from(mergedByCustomerId.values()).map((row) => {
    const id = rowId(row);
    const customer = customersById.get(id) ?? null;
    return {
      ...row,
      customer_id: id,
      customer_name:
        (typeof row?.customer_name === "string" && row.customer_name) ||
        (typeof customer?.name === "string" ? customer.name : "לקוח"),
      name:
        typeof customer?.name === "string"
          ? customer.name
          : typeof row?.name === "string"
            ? row.name
            : null,
      name_for_invoice:
        typeof customer?.name_for_invoice === "string" ? customer.name_for_invoice : null,
      registration_number:
        typeof customer?.registration_number === "string"
          ? customer.registration_number
          : null,
      address: typeof customer?.address === "string" ? customer.address : null,
      notes: typeof customer?.notes === "string" ? customer.notes : null,
      active: customer?.active !== false,
      email:
        (typeof customer?.email === "string" && customer.email) ||
        (typeof row?.email === "string" ? row.email : null),
      phone:
        (typeof customer?.phone === "string" && customer.phone) ||
        (typeof row?.phone === "string" ? row.phone : null),
    };
  });

  const mergedIds = new Set(
    merged
      .map((row) => (typeof row?.customer_id === "string" ? row.customer_id : ""))
      .filter(Boolean)
  );

  const customersOnly = customers
    .filter((row) => {
      const id = typeof row?.id === "string" ? row.id : "";
      return id && !mergedIds.has(id);
    })
    .map((row) => ({
      customer_id: row.id,
      customer_name: typeof row?.name === "string" ? row.name : "לקוח",
      email: typeof row?.email === "string" ? row.email : null,
      phone: typeof row?.phone === "string" ? row.phone : null,
      orders_count: 0,
      projects_count: 0,
      total_sales: 0,
      total_paid: 0,
      open_balance: 0,
      last_order_at: null,
      last_payment_at: null,
      name: typeof row?.name === "string" ? row.name : null,
      name_for_invoice:
        typeof row?.name_for_invoice === "string" ? row.name_for_invoice : null,
      registration_number:
        typeof row?.registration_number === "string" ? row.registration_number : null,
      address: typeof row?.address === "string" ? row.address : null,
      notes: typeof row?.notes === "string" ? row.notes : null,
      active: row?.active !== false,
    }));

  const allRows = [...merged, ...customersOnly];

  const contactsByCustomerId = new Map<string, Row[]>();
  contacts.forEach((row) => {
    const customerId = typeof row?.customer_id === "string" ? row.customer_id.trim() : "";
    if (!customerId) return;
    const list = contactsByCustomerId.get(customerId) ?? [];
    list.push(row);
    contactsByCustomerId.set(customerId, list);
  });

  const allRowsWithContacts = allRows.map((row) => {
    const id = rowId(row);
    return { ...row, contacts: contactsByCustomerId.get(id) ?? [] };
  });

  const loadError =
    overviewError?.message ??
    customersError?.message ??
    contactsError?.message ??
    activityError?.message ??
    openBalanceError?.message ??
    ordersError?.message ??
    projectsError?.message ??
    salesSummaryError?.message ??
    null;

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
          <CustomersClient initialRows={allRowsWithContacts as Row[]} />
        )}
      </div>
    </AppShell>
  );
}

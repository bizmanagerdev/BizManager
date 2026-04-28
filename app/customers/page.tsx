import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { requireProfile } from "@/lib/auth/requireProfile";
import CustomersClient from "@/app/customers/CustomersClient";

type Row = Record<string, unknown>;

const PAGE_SIZE = 50;

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

  const customerById = new Map<string, Row>();
  ((customerRows ?? []) as Row[]).forEach((row) => {
    const id = typeof row?.id === "string" ? row.id.trim() : "";
    if (!id) return;
    customerById.set(id, row);
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
    return {
      ...row,
      whatsapp: typeof customer?.whatsapp === "string" ? customer.whatsapp : null,
      contacts: contactsByCustomerId.get(id) ?? [],
    };
  });

  const loadError = overviewError?.message ?? contactsError?.message ?? customerRowsError?.message ?? null;
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

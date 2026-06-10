import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import NewOrderClient from "@/app/sales/orders/new/NewOrderClient";

type Row = Record<string, unknown>;

export default async function NewSalesOrderPage({
  searchParams,
}: {
  searchParams?: Promise<{ customer_id?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const prefillCustomerId =
    typeof params.customer_id === "string" && params.customer_id.trim()
      ? params.customer_id.trim()
      : null;

  const { profile, supabase } = await requireProfile();

  const [{ data: customers, error: customersError }, { data: products, error: productsError }] =
    await Promise.all([
      supabase
        .from("customers")
        .select("id,name,name_for_invoice,phone,whatsapp,email,address,requires_prepayment")
        .order("name", { ascending: true })
        .range(0, 49),
      supabase
        .from("products_with_last_used")
        .select("id,name,sku,barcode,description,base_price,base_cost,active,order_count,last_used_at")
        .order("order_count", { ascending: false })
        .order("name", { ascending: true })
        .range(0, 49),
    ]);

  let customerList = (customers ?? []) as Row[];
  if (prefillCustomerId && !customerList.some((row) => row.id === prefillCustomerId)) {
    const { data: prefillCustomer } = await supabase
      .from("customers")
      .select("id,name,name_for_invoice,phone,whatsapp,email,address,requires_prepayment")
      .eq("id", prefillCustomerId)
      .maybeSingle();
    if (prefillCustomer) {
      customerList = [prefillCustomer as Row, ...customerList];
    }
  }

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <div className="space-y-4">
        <NewOrderClient
          customers={customerList}
          products={(products ?? []) as Row[]}
          customersError={customersError?.message ?? null}
          productsError={productsError?.message ?? null}
        />
      </div>
    </AppShell>
  );
}

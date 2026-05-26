import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import NewOrderClient from "@/app/sales/orders/new/NewOrderClient";

type Row = Record<string, unknown>;

export default async function NewSalesOrderPage() {
  const { profile, supabase } = await requireProfile();

  const [{ data: customers, error: customersError }, { data: products, error: productsError }] =
    await Promise.all([
      supabase
        .from("customers")
        .select("id,name,name_for_invoice,phone,email,address,requires_prepayment")
        .order("name", { ascending: true })
        .range(0, 49),
      supabase
        .from("products_with_last_used")
        .select("id,name,sku,barcode,description,base_price,base_cost,active,order_count,last_used_at")
        .order("order_count", { ascending: false })
        .order("name", { ascending: true })
        .range(0, 49),
    ]);

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">הזמנה חדשה</h1>
          <p className="text-sm text-muted-foreground">
            בחירת לקוח, הוספת מוצרים ובדיקה לפני שליחה.
          </p>
        </div>

        <NewOrderClient
          customers={(customers ?? []) as Row[]}
          products={(products ?? []) as Row[]}
          customersError={customersError?.message ?? null}
          productsError={productsError?.message ?? null}
        />
      </div>
    </AppShell>
  );
}

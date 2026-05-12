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
        .select("id,name,phone,email,address,requires_prepayment")
        .order("name", { ascending: true })
        .range(0, 49),
      supabase
        .from("products")
        .select("id,name,sku,barcode,description,base_price,base_cost,active")
        .order("name", { ascending: true })
        .range(0, 49),
    ]);

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined}>
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

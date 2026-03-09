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
        .select("id,name,name_for_invoice,registration_number,phone,email,address,active,notes")
        .limit(5000),
      supabase.from("products").select("*").limit(1000),
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

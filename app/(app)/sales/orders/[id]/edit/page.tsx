import AppShell from "@/components/layout/AppShell";
import { requireStaffPage } from "@/lib/auth/roleAccess";
import NewOrderClient from "@/app/(app)/sales/orders/new/NewOrderClient";
import { loadOrderEditData } from "@/lib/orders/order-edit-data";

// The order form on its own page, for an existing order. It starts from the
// same read as the edit dialog (lib/orders/order-edit-data.ts) — the order's
// own payment terms, due date, invoice and collect-on-delivery settings, and
// custom lines by name — so saving here keeps them (it used to reset them).

export default async function EditSalesOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { profile, supabase } = await requireStaffPage();

  const result = await loadOrderEditData(supabase, id, { deliveryImages: false });

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">עריכת הזמנה</h1>
          <p className="text-sm text-muted-foreground">עדכון לקוח, מוצרים ותשלום להזמנה קיימת.</p>
        </div>

        {!result.ok ? (
          result.status === 404 ? (
            <p className="text-sm text-muted-foreground">ההזמנה לא נמצאה.</p>
          ) : (
            <p className="text-sm text-destructive">שגיאת הזמנה: {result.error}</p>
          )
        ) : (
          <NewOrderClient
            customers={result.data.customers}
            products={result.data.products}
            customersError={null}
            productsError={null}
            mode="edit"
            initialOrder={result.data.initialOrder}
            initialPayments={result.data.initialPayments}
          />
        )}
      </div>
    </AppShell>
  );
}

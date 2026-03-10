import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import InventoryRealtimeBadge from "@/app/inventory/InventoryRealtimeBadge";
import SalesInventoryClient from "@/app/sales/SalesInventoryClient";

type Row = Record<string, unknown>;

export const revalidate = 30;

export default async function InventoryPage() {
  const { profile, supabase } = await requireProfile();

  const [
    { data: movements, error: movementsError },
    { data: inventoryRows, error: inventoryError },
    { data: products, error: productsError },
  ] = await Promise.all([
    supabase
      .from("inventory_movements")
      .select("id,product_id,movement_type,quantity,source_type,source_id,performed_by,notes,created_at")
      .order("created_at", { ascending: false })
      .limit(5000),
    supabase
      .from("inventory")
      .select("product_id,quantity_on_hand,quantity_reserved,updated_at")
      .limit(5000),
    supabase.from("products").select("*").limit(5000),
  ]);

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined}>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">מלאי</h1>
            <p className="text-sm text-muted-foreground">
              רמות מלאי, התראות מלאי נמוך והתאמות ידניות.
            </p>
          </div>
          <InventoryRealtimeBadge />
        </div>

        {inventoryError ? (
          <p className="text-sm text-destructive">שגיאה בטעינת מלאי: {inventoryError.message}</p>
        ) : movementsError ? (
          <p className="text-sm text-destructive">שגיאה בטעינת תנועות מלאי: {movementsError.message}</p>
        ) : productsError ? (
          <p className="text-sm text-destructive">שגיאה בטעינת מוצרים: {productsError.message}</p>
        ) : (
          <SalesInventoryClient
            products={(products ?? []) as Row[]}
            inventoryRows={(inventoryRows ?? []) as Row[]}
            movements={(movements ?? []) as Row[]}
          />
        )}
      </div>
    </AppShell>
  );
}


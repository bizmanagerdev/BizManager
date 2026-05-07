import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { requireProfile } from "@/lib/auth/requireProfile";
import InventoryRealtimeBadge from "@/app/inventory/InventoryRealtimeBadge";
import SalesInventoryClient from "@/app/sales/SalesInventoryClient";

type Row = Record<string, unknown>;

export const revalidate = 30;

const PAGE_SIZE = 50;
const MOVEMENTS_PAGE_SIZE = 200;

function getString(row: Row, key: string) {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function parsePage(value: string | undefined) {
  const page = Number(value ?? "1");
  return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
}

function buildInventoryHref(page: number) {
  return page <= 1 ? "/inventory" : `/inventory?page=${page}`;
}

export default async function InventoryPage({
  searchParams,
}: {
  searchParams?: Promise<{ page?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const page = parsePage(params.page);
  const from = (page - 1) * PAGE_SIZE;
  const to = page * PAGE_SIZE - 1;

  const { profile, supabase } = await requireProfile();

  const {
    data: products,
    error: productsError,
    count,
  } = await supabase
    .from("products")
    .select("id,name,sku,barcode,description,base_price,base_cost,active", {
      count: "estimated",
    })
    .order("name", { ascending: true })
    .range(from, to);

  const productIds = ((products ?? []) as Row[])
    .map((row) => getString(row, "id"))
    .filter((value): value is string => Boolean(value));

  const [
    { data: inventoryRows, error: inventoryError },
    { data: movements, error: movementsError },
    { data: soldMovements, error: soldMovementsError },
  ] =
    productIds.length > 0
      ? await Promise.all([
          supabase
            .from("inventory")
            .select("product_id,quantity_on_hand,quantity_reserved,updated_at")
            .in("product_id", productIds),
          supabase
            .from("inventory_movements")
            .select("id,product_id,movement_type,quantity,source_type,source_id,performed_by,notes,created_at")
            .in("product_id", productIds)
            .order("created_at", { ascending: false })
            .range(0, MOVEMENTS_PAGE_SIZE - 1),
          supabase
            .from("inventory_movements")
            .select("product_id,movement_type,quantity,source_type")
            .eq("movement_type", "out")
            .eq("source_type", "order")
            .in("product_id", productIds),
        ])
      : [
          { data: [], error: null },
          { data: [], error: null },
          { data: [], error: null },
        ];

  const totalCount = typeof count === "number" ? count : ((products ?? []) as Row[]).length;
  const hasPreviousPage = page > 1;
  const hasNextPage = typeof count === "number" ? to + 1 < count : ((products ?? []) as Row[]).length === PAGE_SIZE;

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
        ) : movementsError || soldMovementsError ? (
          <p className="text-sm text-destructive">
            שגיאה בטעינת תנועות מלאי: {movementsError?.message ?? soldMovementsError?.message}
          </p>
        ) : productsError ? (
          <p className="text-sm text-destructive">שגיאה בטעינת מוצרים: {productsError.message}</p>
        ) : (
          <>
            <SalesInventoryClient
              products={(products ?? []) as Row[]}
              inventoryRows={(inventoryRows ?? []) as Row[]}
              soldMovements={(soldMovements ?? []) as Row[]}
              movements={(movements ?? []) as Row[]}
            />
            <div className="flex items-center justify-between gap-3 border-t pt-4 text-sm">
              <div className="text-muted-foreground">
                עמוד {page} • מוצגים {((products ?? []) as Row[]).length} מתוך {totalCount}
              </div>
              <div className="flex gap-2">
                {hasPreviousPage ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={buildInventoryHref(page - 1)}>הקודם</Link>
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" disabled>
                    הקודם
                  </Button>
                )}
                {hasNextPage ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={buildInventoryHref(page + 1)}>הבא</Link>
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

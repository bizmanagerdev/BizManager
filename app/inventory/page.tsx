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

function getNumber(row: Row, key: string) {
  const value = row[key];
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isMissingColumnError(error: unknown, columnName: string) {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? error.code : null;
  const message = "message" in error ? error.message : null;
  return (
    code === "42703" &&
    typeof message === "string" &&
    message.toLowerCase().includes(columnName.toLowerCase())
  );
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
    { data: customerReturnMovements, error: customerReturnMovementsError },
    thresholdResult,
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
          supabase
            .from("inventory_movements")
            .select("product_id,movement_type,quantity,source_type,notes")
            .eq("movement_type", "in")
            .eq("source_type", "manual_adjustment")
            .in("product_id", productIds)
            .or("notes.ilike.%החזרת לקוח%,notes.ilike.%customer return%"),
          supabase.from("products").select("id,low_stock_threshold").in("id", productIds),
        ])
      : [
          { data: [], error: null },
          { data: [], error: null },
          { data: [], error: null },
          { data: [], error: null },
          { data: [], error: null },
        ];

  const thresholdRows = isMissingColumnError(thresholdResult.error, "low_stock_threshold")
    ? []
    : ((thresholdResult.data ?? []) as Row[]);
  const thresholdsError = isMissingColumnError(thresholdResult.error, "low_stock_threshold")
    ? null
    : thresholdResult.error;

  const lowStockThresholdByProductId = Object.fromEntries(
    thresholdRows
      .map((row) => {
        const id = getString(row, "id");
        if (!id) return null;
        return [id, getNumber(row, "low_stock_threshold") ?? 5] as const;
      })
      .filter((entry): entry is readonly [string, number] => entry !== null)
  );

  const soldAmountByProductId = Object.fromEntries(
    productIds.map((productId) => {
      const soldQty = ((soldMovements ?? []) as Row[])
        .filter((row) => getString(row, "product_id") === productId)
        .reduce((sum, row) => sum + (getNumber(row, "quantity") ?? 0), 0);
      const returnedQty = ((customerReturnMovements ?? []) as Row[])
        .filter((row) => getString(row, "product_id") === productId)
        .reduce((sum, row) => sum + (getNumber(row, "quantity") ?? 0), 0);
      return [productId, Math.max(0, soldQty - returnedQty)];
    })
  );

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
        ) : movementsError || soldMovementsError || customerReturnMovementsError ? (
          <p className="text-sm text-destructive">
            שגיאה בטעינת תנועות מלאי: {movementsError?.message ?? soldMovementsError?.message ?? customerReturnMovementsError?.message}
          </p>
        ) : productsError ? (
          <p className="text-sm text-destructive">שגיאה בטעינת מוצרים: {productsError.message}</p>
        ) : thresholdsError ? (
          <p className="text-sm text-destructive">טעינת ספי מלאי נכשלה: {thresholdsError.message}</p>
        ) : (
          <>
            <SalesInventoryClient
              products={(products ?? []) as Row[]}
              inventoryRows={(inventoryRows ?? []) as Row[]}
              soldAmountByProductId={soldAmountByProductId}
              lowStockThresholdByProductId={lowStockThresholdByProductId}
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

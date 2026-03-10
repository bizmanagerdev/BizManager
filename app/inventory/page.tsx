import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import InventoryRealtimeBadge from "@/app/inventory/InventoryRealtimeBadge";

type Row = Record<string, unknown>;

export const revalidate = 30;

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

export default async function InventoryPage() {
  const { profile, supabase } = await requireProfile();

  const { data, error } = await supabase
    .from("inventory_movements")
    .select("id,product_id,movement_type,quantity,source_type,source_id,performed_by,notes,created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  const rows = (data ?? []) as Row[];

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined}>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">מלאי</h1>
            <p className="text-sm text-muted-foreground">מעקב תנועות מלאי בזמן אמת.</p>
          </div>
          <InventoryRealtimeBadge />
        </div>

        {error ? (
          <p className="text-sm text-destructive">שגיאה בטעינת תנועות מלאי: {error.message}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">אין תנועות מלאי להצגה.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="min-w-[850px] w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-right font-medium">מוצר</th>
                  <th className="px-3 py-2 text-right font-medium">סוג תנועה</th>
                  <th className="px-3 py-2 text-right font-medium">כמות</th>
                  <th className="px-3 py-2 text-right font-medium">תאריך</th>
                  <th className="px-3 py-2 text-right font-medium">הערות</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((row, index) => {
                  const id = getString(row, "id") ?? `movement-${index}`;
                  const productId = getString(row, "product_id") ?? "-";
                  const movementType = getString(row, "movement_type") ?? "-";
                  const quantity = getNumber(row, "quantity");
                  const movementDate = getString(row, "created_at") ?? "-";
                  const notes = getString(row, "notes") ?? "-";

                  return (
                    <tr key={id} className="hover:bg-muted/30">
                      <td className="px-3 py-2">{productId}</td>
                      <td className="px-3 py-2">{movementType}</td>
                      <td className="px-3 py-2">{quantity ?? "-"}</td>
                      <td className="px-3 py-2">{movementDate}</td>
                      <td className="px-3 py-2">{notes}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}

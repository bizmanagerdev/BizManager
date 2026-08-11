import AppShell from "@/components/layout/AppShell";
import PageAlertBar from "@/components/reminders/PageAlertBar";
import { requireStaffPage } from "@/lib/auth/roleAccess";
import InventoryRealtimeBadge from "@/app/(app)/inventory/InventoryRealtimeBadge";
import SalesInventoryClient from "@/app/(app)/sales/SalesInventoryClient";
import { loadInventoryListPage } from "@/app/(app)/sales/loadProducts";

export default async function InventoryPage() {
  const { profile, supabase } = await requireStaffPage();

  const { items, movements, totalCount, hasMore, error } = await loadInventoryListPage(supabase, {
    page: 1,
    filters: { q: "", category: "" },
  });

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <div className="space-y-4">
        <PageAlertBar keys={["low_stock"]} />
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">מלאי</h1>
            <p className="text-sm text-muted-foreground">
              רמות מלאי, התראות מלאי נמוך והתאמות ידניות.
            </p>
          </div>
          <InventoryRealtimeBadge />
        </div>

        {error ? (
          <p className="text-sm text-destructive">שגיאה בטעינת מלאי: {error}</p>
        ) : (
          <SalesInventoryClient
            initialItems={items}
            movements={movements}
            initialHasMore={hasMore}
            totalCount={totalCount}
          />
        )}
      </div>
    </AppShell>
  );
}

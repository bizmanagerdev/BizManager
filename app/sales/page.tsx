import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { requireProfile } from "@/lib/auth/requireProfile";
import SalesOrdersClient from "@/app/sales/SalesOrdersClient";

type Row = Record<string, unknown>;

export default async function SalesPage() {
  const { profile, supabase } = await requireProfile();

  const [{ data: orders, error: ordersError }, { data: customers, error: customersError }] =
    await Promise.all([
      supabase.from("orders").select("*").order("order_date", { ascending: false }).limit(1000),
      supabase
        .from("customers")
        .select("id,name,name_for_invoice,registration_number,phone,email,address,active,notes")
        .limit(5000),
    ]);

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined}>
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">מכירות</h1>
            <p className="text-sm text-muted-foreground">
              ניהול הזמנות, מעקב הזמנות פעילות וסינון לפי לקוח ועיר.
            </p>
          </div>

          <div>
            <Button asChild>
              <Link href="/sales/orders/new">הזמנה חדשה</Link>
            </Button>
          </div>
        </div>

        {ordersError ? (
          <p className="text-sm text-destructive">שגיאת הזמנות: {ordersError.message}</p>
        ) : null}
        {customersError ? (
          <p className="text-sm text-destructive">שגיאת לקוחות: {customersError.message}</p>
        ) : null}

        <SalesOrdersClient
          orders={(orders ?? []) as Row[]}
          customers={(customers ?? []) as Row[]}
        />
      </div>
    </AppShell>
  );
}

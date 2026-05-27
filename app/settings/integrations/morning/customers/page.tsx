import AppShell from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireProfile } from "@/lib/auth/requireProfile";

export default async function MorningCustomersSettingsPage() {
  const { profile, supabase } = await requireProfile();
  const { data: customers, error } = await supabase
    .from("customers")
    .select("id,name,morning_client_id,morning_match_status,morning_synced_at,morning_last_sync_error")
    .order("name", { ascending: true })
    .range(0, 199);

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <div className="space-y-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Morning: התאמת לקוחות</h1>
          <p className="text-sm text-muted-foreground">מסך בקרה לקישור בטוח בין לקוחות BizH ללקוחות Morning.</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>לקוחות מקומיים</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {error ? <div className="text-destructive">{error.message}</div> : null}
            {(customers ?? []).map((customer) => (
              <div key={customer.id} className="rounded-xl border p-3">
                <div className="font-medium">{customer.name}</div>
                <div className="text-muted-foreground">
                  סטטוס Morning: {customer.morning_match_status ?? "unmatched"}
                  {customer.morning_client_id ? ` • לקוח Morning: ${customer.morning_client_id}` : ""}
                </div>
                {customer.morning_last_sync_error ? (
                  <div className="mt-1 text-destructive">{customer.morning_last_sync_error}</div>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

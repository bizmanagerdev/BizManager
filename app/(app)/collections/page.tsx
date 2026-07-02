import { redirect } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { requireProfile } from "@/lib/auth/requireProfile";
import { getCollectionsData, getPaymentsDueToday, type PaymentDueToday } from "@/lib/collections";
import CollectionsClient from "./CollectionsClient";

export const revalidate = 60;

export default async function CollectionsPage() {
  const { profile, supabase } = await requireProfile();

  // Collections is a back-office money tool — admin/office only.
  if (profile.role !== "admin" && profile.role !== "office") {
    redirect("/no-access");
  }

  const data = await getCollectionsData(supabase);
  // Best-effort: payment table may not be migrated yet.
  const dueToday: PaymentDueToday[] = await getPaymentsDueToday(supabase).catch(() => [] as PaymentDueToday[]);

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <div className="space-y-4 text-right" dir="rtl">
        {data.loadError ? (
          <Card>
            <CardContent className="py-6 text-sm text-destructive">
              {`שגיאה בטעינת נתוני הגבייה: ${data.loadError}`}
              <div className="mt-2 text-xs text-muted-foreground">
                ייתכן שצריך להריץ את db/sql/create_collections_view.sql ב-Supabase.
              </div>
            </CardContent>
          </Card>
        ) : (
          <CollectionsClient customers={data.customers} totals={data.totals} dueToday={dueToday} />
        )}
      </div>
    </AppShell>
  );
}

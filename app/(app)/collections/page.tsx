import { redirect } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import PageAlertBar from "@/components/reminders/PageAlertBar";
import { Card, CardContent } from "@/components/ui/card";
import { requireProfile } from "@/lib/auth/requireProfile";
import { getCollectionsData, getPaymentsDueToday, type PaymentDueToday } from "@/lib/collections";
import DunningStagesEditor from "@/components/notifications/DunningStagesEditor";
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
      {/* OUTSIDE the space-y-4 below — see tasks/page.tsx for why (space-y adds
          margin-top to any sibling with a preceding one, even PageAlertBar's
          own zero-height node, which read as a white gap that closed the
          instant every alert was dismissed). */}
      <PageAlertBar keys={["collection_overdue", "payment_due_today", "promise_broken", "check_deposit_due"]} />
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

        {/* The dunning ladder drives the automatic collection chase, so it lives
            here with the debtors it acts on — not buried in the alert settings. */}
        {profile.role === "admin" ? (
          <details className="group rounded-2xl border border-border/60 bg-card">
            <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium">
              <span className="text-muted-foreground group-open:hidden">▸ </span>
              <span className="hidden text-muted-foreground group-open:inline">▾ </span>
              מדרגות גבייה — מתי נשלחות תזכורות אוטומטיות
            </summary>
            <div className="border-t border-border/60 p-4">
              <DunningStagesEditor />
            </div>
          </details>
        ) : null}
      </div>
    </AppShell>
  );
}

import { redirect } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { requireProfile } from "@/lib/auth/requireProfile";
import { getCollectionsData, getPaymentsDueToday, type PaymentDueToday } from "@/lib/collections";
import {
  getOpenReminders,
  getRecentCommunications,
  type CommunicationLogWithCustomer,
  type Reminder,
} from "@/lib/communications";
import CollectionsClient from "./CollectionsClient";

export const revalidate = 60;

export default async function CollectionsPage() {
  const { profile, supabase } = await requireProfile();

  // Collections is a back-office money tool — admin/office only.
  if (profile.role !== "admin" && profile.role !== "office") {
    redirect("/no-access");
  }

  // Everyone reaching this page is admin/office (guarded above), so the "all"
  // scope is always available here.
  const canSeeAll = true;
  const data = await getCollectionsData(supabase);
  // Best-effort: reminders / communication tables may not be migrated yet.
  let remindersMine: Reminder[] = [];
  let remindersAll: Reminder[] = [];
  let recentLogs: CommunicationLogWithCustomer[] = [];
  let dueToday: PaymentDueToday[] = [];
  try {
    [remindersMine, remindersAll, recentLogs, dueToday] = await Promise.all([
      getOpenReminders(supabase, { scope: "mine", userId: profile.id }).catch(() => [] as Reminder[]),
      getOpenReminders(supabase, { scope: "all" }).catch(() => [] as Reminder[]),
      getRecentCommunications(supabase).catch(() => [] as CommunicationLogWithCustomer[]),
      getPaymentsDueToday(supabase).catch(() => [] as PaymentDueToday[]),
    ]);
  } catch {
    remindersMine = [];
    remindersAll = [];
    recentLogs = [];
    dueToday = [];
  }

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
          <CollectionsClient
            customers={data.customers}
            totals={data.totals}
            remindersMine={remindersMine}
            remindersAll={remindersAll}
            canSeeAll={canSeeAll}
            recentLogs={recentLogs}
            dueToday={dueToday}
          />
        )}
      </div>
    </AppShell>
  );
}

import { redirect } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import PageAlertBar from "@/components/reminders/PageAlertBar";
import { Card, CardContent } from "@/components/ui/card";
import { requireProfile } from "@/lib/auth/requireProfile";
import { getChecks } from "@/lib/checks";
import ChecksClient from "./ChecksClient";

export const revalidate = 60;

export default async function ChecksPage() {
  const { profile, supabase } = await requireProfile();

  // Checks are a back-office cash tool — admin/office only.
  if (profile.role !== "admin" && profile.role !== "office") {
    redirect("/no-access");
  }

  const data = await getChecks(supabase);

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      {/* OUTSIDE the space-y-4 below — see tasks/page.tsx for why (space-y adds
          margin-top to any sibling with a preceding one, even PageAlertBar's
          own zero-height node, which read as a white gap that closed the
          instant every alert was dismissed). */}
      <PageAlertBar keys={["check_deposit_due"]} />
      <div className="space-y-4 text-right" dir="rtl">
        {data.loadError ? (
          <Card>
            <CardContent className="py-6 text-sm text-destructive">
              {`שגיאה בטעינת הצ׳קים: ${data.loadError}`}
            </CardContent>
          </Card>
        ) : (
          <ChecksClient checks={data.checks} />
        )}
      </div>
    </AppShell>
  );
}

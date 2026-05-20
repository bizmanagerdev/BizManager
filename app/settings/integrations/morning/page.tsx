import AppShell from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireProfile } from "@/lib/auth/requireProfile";
import { loadMorningSettings } from "@/lib/morning/settings";
import Link from "next/link";
import MorningAutoIssueForm from "./MorningAutoIssueForm";

export default async function MorningSettingsPage() {
  const { profile, supabase } = await requireProfile();
  if (profile.role !== "admin") {
    return (
      <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
        <div className="rounded-xl border p-4 text-sm text-muted-foreground">
          רק מנהל מורשה לערוך הגדרות Morning.
        </div>
      </AppShell>
    );
  }
  const settings = await loadMorningSettings(supabase);

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold">Morning: הגדרות אוטומציה</h1>
            <p className="text-sm text-muted-foreground">
              שליטה ביצירה אוטומטית של חשבוניות וקבלות ב-Morning בעת סגירת הזמנות ורישום תשלומים.
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href="/settings">חזרה להגדרות</Link>
          </Button>
        </div>

        <MorningAutoIssueForm initial={settings} />

        <Card>
          <CardHeader>
            <CardTitle>קישורים נוספים</CardTitle>
            <CardDescription>ניהול לקוחות Morning ובדיקת חיבור.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href="/settings/integrations/morning/customers">התאמת לקוחות Morning</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/api/morning/health" target="_blank">
                בדיקת חיבור (health)
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

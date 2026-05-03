import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import ProjectsCalendar from "@/app/projects/ProjectsCalendar";
import { requireProfile } from "@/lib/auth/requireProfile";
import { getAlertsData, type AlertItem } from "@/lib/alerts";
import { getScheduleEntries } from "@/lib/projectSchedule";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const revalidate = 60;

function badgeVariantForAlert(severity: AlertItem["severity"]) {
  switch (severity) {
    case "danger":
      return "destructive" as const;
    case "warning":
      return "warning" as const;
    default:
      return "secondary" as const;
  }
}

export default async function AlertsPage() {
  const { profile, supabase } = await requireProfile();
  const todayIso = new Date().toISOString().slice(0, 10);
  const [{ alerts, errors }, projectScheduleResult] = await Promise.all([
    getAlertsData(supabase, { viewerRole: profile.role }),
    getScheduleEntries(supabase).then(
      (entries) => ({ entries, error: null as string | null }),
      (error: { message?: string }) => ({
        entries: [],
        error: error?.message ?? "שגיאה בטעינת לוח הזמנים",
      })
    ),
  ]);
  const activeAlertsCount = alerts.filter((alert) => (alert.countsAsActiveAlert ?? true) && alert.count > 0).length;
  const pageErrors = [errors.dashboard, errors.invoices, errors.payroll, errors.projects, projectScheduleResult.error].filter(
    Boolean
  ) as string[];

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined}>
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">התראות</h1>
            <p className="text-sm text-muted-foreground">כל מה שדורש תשומת לב במקום אחד.</p>
          </div>
          <Badge variant="outline" className="w-fit text-sm">
            {activeAlertsCount > 0 ? `${activeAlertsCount} התראות פעילות` : "אין התראות פעילות"}
          </Badge>
        </div>

        {pageErrors.length > 0 ? (
          <Card className="border-destructive/40">
            <CardContent className="p-4 text-sm text-destructive">{pageErrors.join(" | ")}</CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>כל ההתראות</CardTitle>
            <CardDescription>אפשר להיכנס מכל פריט ישירות למסך הרלוונטי.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className="flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <div className="font-medium">{alert.title}</div>
                    <Badge variant={badgeVariantForAlert(alert.severity)}>{alert.count}</Badge>
                  </div>
                  <div className="text-sm text-muted-foreground">{alert.description}</div>
                </div>
                <Button asChild variant="outline" className="w-full sm:w-auto">
                  <Link href={alert.href}>פתח</Link>
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>

        <ProjectsCalendar entries={projectScheduleResult.entries} todayIso={todayIso} />
      </div>
    </AppShell>
  );
}


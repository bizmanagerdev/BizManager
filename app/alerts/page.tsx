import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import { getAlertsData, type AlertItem } from "@/lib/alerts";
import { getScheduleEntries, type CalendarEntry } from "@/lib/projectSchedule";
import { getTodayInboxData } from "@/lib/today-inbox";
import TodayInbox from "@/components/TodayInbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import PushSubscribeButton from "@/components/notifications/PushSubscribeButton";
import CalendarSection from "@/app/alerts/CalendarSection";

export const revalidate = 60;

const SEVERITY_CONFIG = {
  danger: {
    border: "border-destructive/40",
    bg: "bg-destructive/5",
    dot: "bg-destructive",
    badge: "destructive" as const,
  },
  warning: {
    border: "border-warning/40",
    bg: "bg-warning/5",
    dot: "bg-warning",
    badge: "warning" as const,
  },
  info: {
    border: "border-border",
    bg: "bg-secondary/10",
    dot: "bg-muted-foreground/40",
    badge: "secondary" as const,
  },
};

export default async function AlertsPage() {
  const { profile, supabase } = await requireProfile();
  const todayIso = new Date().toISOString().slice(0, 10);
  const canSeeAll = profile.role === "admin" || profile.role === "office";

  const safeSchedule = (p: Promise<CalendarEntry[]>) =>
    p.then(
      (entries) => ({ entries, error: null as string | null }),
      (error: { message?: string }) => ({
        entries: [] as CalendarEntry[],
        error: error?.message ?? "שגיאה בטעינת לוח הזמנים",
      })
    );

  const [{ alerts, errors }, mineSchedule, allSchedule, todayInbox] = await Promise.all([
    getAlertsData(supabase, { viewerRole: profile.role }),
    safeSchedule(getScheduleEntries(supabase, { scope: "mine", userId: profile.id })),
    canSeeAll
      ? safeSchedule(getScheduleEntries(supabase, { scope: "all", userId: profile.id }))
      : Promise.resolve({ entries: [] as CalendarEntry[], error: null as string | null }),
    getTodayInboxData(supabase, profile),
  ]);

  const pageErrors = [
    errors.dashboard,
    errors.invoices,
    errors.payroll,
    errors.projects,
    mineSchedule.error,
    allSchedule.error,
  ].filter(Boolean) as string[];

  const actionAlerts = alerts.filter(
    (a) => (a.countsAsActiveAlert ?? true) && a.count > 0 && a.severity !== "info"
  );
  const infoAlerts = alerts.filter(
    (a) => !(a.countsAsActiveAlert ?? true) || a.count === 0 || a.severity === "info"
  );

  const allClear = actionAlerts.length === 0;

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <div className="space-y-5">

        <div className="flex justify-end">
          <PushSubscribeButton />
        </div>

        {pageErrors.length > 0 && (
          <Card className="border-destructive/40">
            <CardContent className="p-4 text-sm text-destructive">{pageErrors.join(" | ")}</CardContent>
          </Card>
        )}

        <TodayInbox data={todayInbox} />

        {allClear && (
          <div className="flex items-center gap-3 rounded-xl border border-success/40 bg-success-soft px-5 py-4">
            <div className="text-2xl">✓</div>
            <div>
              <div className="font-semibold text-success-soft-foreground">הכול יציב</div>
              <div className="text-sm text-muted-foreground">אין פריטים שדורשים טיפול כרגע.</div>
            </div>
          </div>
        )}

        {actionAlerts.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">דורש טיפול</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {actionAlerts.map((alert) => (
                <ActionAlertCard key={alert.id} alert={alert} />
              ))}
            </CardContent>
          </Card>
        )}

        {infoAlerts.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">סיכום</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-3">
                {infoAlerts.map((alert) => (
                  <InfoAlertChip key={alert.id} alert={alert} />
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <CalendarSection
          entries={mineSchedule.entries}
          allEntries={canSeeAll ? allSchedule.entries : null}
          todayIso={todayIso}
        />

      </div>
    </AppShell>
  );
}

function ActionAlertCard({ alert }: { alert: AlertItem }) {
  const cfg = SEVERITY_CONFIG[alert.severity] ?? SEVERITY_CONFIG.info;
  return (
    <div className={`flex items-center justify-between gap-4 rounded-xl border p-4 ${cfg.border} ${cfg.bg}`}>
      <div className="flex items-start gap-3">
        <div className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${cfg.dot}`} />
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="font-semibold">{alert.title}</span>
            <Badge variant={cfg.badge}>{alert.count}</Badge>
          </div>
          <div className="text-sm text-muted-foreground">{alert.description}</div>
        </div>
      </div>
      <Button asChild variant="outline" size="sm" className="shrink-0">
        <Link href={alert.href}>פתח</Link>
      </Button>
    </div>
  );
}

function InfoAlertChip({ alert }: { alert: AlertItem }) {
  return (
    <Link
      href={alert.href}
      className="flex items-center gap-2 rounded-xl border bg-secondary/10 px-3 py-2 text-sm transition-colors hover:bg-secondary/20"
    >
      <span className="text-muted-foreground">{alert.title}</span>
      <Badge variant="secondary">{alert.count}</Badge>
    </Link>
  );
}

import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import { getAlertsData, type AlertItem } from "@/lib/alerts";
import { getScheduleEntries } from "@/lib/projectSchedule";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
    bg: "bg-muted/20",
    dot: "bg-muted-foreground/40",
    badge: "secondary" as const,
  },
};

export default async function AlertsPage() {
  const { profile, supabase } = await requireProfile();
  const todayIso = new Date().toISOString().slice(0, 10);

  const [{ alerts, errors }, scheduleResult] = await Promise.all([
    getAlertsData(supabase, { viewerRole: profile.role }),
    getScheduleEntries(supabase).then(
      (entries) => ({ entries, error: null as string | null }),
      (error: { message?: string }) => ({
        entries: [],
        error: error?.message ?? "שגיאה בטעינת לוח הזמנים",
      })
    ),
  ]);

  const pageErrors = [
    errors.dashboard,
    errors.invoices,
    errors.payroll,
    errors.projects,
    scheduleResult.error,
  ].filter(Boolean) as string[];

  // Split alerts: actionable (danger/warning with count > 0) vs info
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

        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">התראות</h1>
            <p className="text-sm text-muted-foreground">כל מה שדורש תשומת לב במקום אחד.</p>
          </div>
          <PushSubscribeButton />
        </div>

        {/* Errors */}
        {pageErrors.length > 0 && (
          <Card className="border-destructive/40">
            <CardContent className="p-4 text-sm text-destructive">{pageErrors.join(" | ")}</CardContent>
          </Card>
        )}

        {/* All clear */}
        {allClear && (
          <div className="flex items-center gap-3 rounded-2xl border border-teal-500/30 bg-teal-500/5 px-5 py-4">
            <div className="text-2xl">✓</div>
            <div>
              <div className="font-semibold text-teal-700 dark:text-teal-400">הכול יציב</div>
              <div className="text-sm text-muted-foreground">אין פריטים שדורשים טיפול כרגע.</div>
            </div>
          </div>
        )}

        {/* Action alerts */}
        {actionAlerts.length > 0 && (
          <div className="space-y-3">
            <div className="text-sm font-semibold text-muted-foreground">דורש טיפול</div>
            {actionAlerts.map((alert) => (
              <ActionAlertCard key={alert.id} alert={alert} />
            ))}
          </div>
        )}

        {/* Info alerts */}
        {infoAlerts.length > 0 && (
          <div className="flex flex-wrap gap-3">
            {infoAlerts.map((alert) => (
              <InfoAlertChip key={alert.id} alert={alert} />
            ))}
          </div>
        )}

        <CalendarSection entries={scheduleResult.entries} todayIso={todayIso} />

      </div>
    </AppShell>
  );
}

function ActionAlertCard({ alert }: { alert: AlertItem }) {
  const cfg = SEVERITY_CONFIG[alert.severity] ?? SEVERITY_CONFIG.info;
  return (
    <div className={`flex items-center justify-between gap-4 rounded-2xl border p-4 ${cfg.border} ${cfg.bg}`}>
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
      className="flex items-center gap-2 rounded-xl border bg-muted/30 px-3 py-2 text-sm transition-colors hover:bg-muted/60"
    >
      <span className="text-muted-foreground">{alert.title}</span>
      <Badge variant="secondary">{alert.count}</Badge>
    </Link>
  );
}

function _LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`inline-block h-2 w-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}

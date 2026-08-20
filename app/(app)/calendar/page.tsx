import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import { getScheduleEntries, type CalendarEntry } from "@/lib/projectSchedule";
import { Card, CardContent } from "@/components/ui/card";
import CalendarSection from "@/app/(app)/calendar/CalendarSection";
import { calendarDict } from "@/lib/i18n/dictionaries/calendar";
import { t } from "@/lib/i18n/t";

export const revalidate = 60;

// "יומן" — the dated agenda: upcoming tasks, project milestones and reminders on
// a calendar. Split out from the worklist ("מה דורש טיפול") so "what to do" and
// "when" are separate views, ERP-style.
export default async function CalendarPage() {
  const { profile, supabase } = await requireProfile();
  const todayIso = new Date().toISOString().slice(0, 10);
  const canSeeAll = profile.role === "admin" || profile.role === "office";

  const safeSchedule = (p: Promise<CalendarEntry[]>) =>
    p.then(
      (entries) => ({ entries, error: null as string | null }),
      (error: { message?: string }) => ({
        entries: [] as CalendarEntry[],
        error: error?.message ?? t(calendarDict, profile.locale, "scheduleLoadError"),
      })
    );

  const [mineSchedule, allSchedule] = await Promise.all([
    safeSchedule(getScheduleEntries(supabase, { scope: "mine", userId: profile.id })),
    canSeeAll
      ? safeSchedule(getScheduleEntries(supabase, { scope: "all", userId: profile.id }))
      : Promise.resolve({ entries: [] as CalendarEntry[], error: null as string | null }),
  ]);

  const pageErrors = [mineSchedule.error, allSchedule.error].filter(Boolean) as string[];

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <div className="space-y-5">
        {pageErrors.length > 0 && (
          <Card className="border-destructive/40">
            <CardContent className="p-4 text-sm text-destructive">{pageErrors.join(" | ")}</CardContent>
          </Card>
        )}

        <CalendarSection
          entries={mineSchedule.entries}
          allEntries={canSeeAll ? allSchedule.entries : null}
          todayIso={todayIso}
          locale={profile.locale}
        />
      </div>
    </AppShell>
  );
}

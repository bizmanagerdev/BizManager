import { Suspense } from "react";
import { redirect } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import { hasSectionAccess, isStaffRole } from "@/lib/auth/roleAccess";
import { getCalendarFeeds, type CalendarEntry } from "@/lib/projectSchedule";
import { Card, CardContent } from "@/components/ui/card";
import CalendarSection from "@/app/(app)/calendar/CalendarSection";
import DashboardLocalShadow from "@/components/powersync/DashboardLocalShadow";
import DeviceFrameMark from "@/components/powersync/DeviceFrameMark";
import { serverRenderedAt } from "@/lib/loaded-at";
import { deviceCheckDue, devicePageOn } from "@/lib/powersync/device-check";
import { LOCAL_DATA_SHADOW, localDataEnabledFor } from "@/lib/powersync/config";
import { calendarDict } from "@/lib/i18n/dictionaries/calendar";
import { t } from "@/lib/i18n/t";
import { israelDateKey } from "@/lib/timezone";
import LocalCalendarPage from "./LocalCalendarPage";
import CalendarServerCheck from "./CalendarServerCheck";

export const revalidate = 60;

// "יומן" — the dated agenda: upcoming tasks, project milestones and reminders on
// a calendar. Split out from the worklist ("מה דורש טיפול") so "what to do" and
// "when" are separate views, ERP-style.
export default async function CalendarPage({ searchParams }: { searchParams?: Promise<{ data?: string }> }) {
  const [{ profile, supabase }, query] = await Promise.all([requireProfile(), searchParams]);
  if (!isStaffRole(profile.role) && !hasSectionAccess(profile.role, profile.section_access, "calendar")) {
    redirect("/no-access");
  }
  const todayIso = israelDateKey();
  const canSeeAll = profile.role === "admin" || profile.role === "office";

  // The device version: the calendar worked out from this person's on-device
  // copy (LocalCalendarPage). ?data=server is the way back when the copy can't
  // serve it; a device whose copy is still incomplete gets the server version
  // at once.
  if (query?.data !== "server" && (await devicePageOn("calendar", profile))) {
    // Once a day per device, the server's own feeds too — streamed after the
    // page, for the device to compare (lib/powersync/device-check.ts).
    const checkDue = LOCAL_DATA_SHADOW.calendar && (await deviceCheckDue("calendar"));
    return (
      <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
        <div className="space-y-5">
          <DeviceFrameMark page="calendar" renderedAt={serverRenderedAt()} />
          <LocalCalendarPage viewer={{ userId: profile.id, role: profile.role ?? "", locale: profile.locale }} />
        </div>
        {checkDue ? (
          <Suspense fallback={null}>
            <CalendarServerCheck supabase={supabase} userId={profile.id} role={profile.role ?? ""} locale={profile.locale} />
          </Suspense>
        ) : null}
      </AppShell>
    );
  }

  // Mine and — for the back office — everyone's, in one read (getCalendarFeeds).
  const { feeds, error } = await getCalendarFeeds(supabase, { userId: profile.id, canSeeAll }).then(
    (feeds) => ({ feeds, error: null as string | null }),
    (failure: { message?: string }) => ({
      feeds: { mine: [] as CalendarEntry[], all: canSeeAll ? ([] as CalendarEntry[]) : null },
      error: failure?.message ?? t(calendarDict, profile.locale, "scheduleLoadError"),
    })
  );

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      {/* The device-copy check for this page (lib/powersync/dashboard-shadow.ts):
          worked out on the device too, and compared. */}
      {LOCAL_DATA_SHADOW.calendar && localDataEnabledFor(profile.role) && !error ? (
        <DashboardLocalShadow
          snapshot={{
            renderedAt: new Date().toISOString(),
            userId: profile.id,
            role: profile.role ?? "",
            locale: profile.locale,
            todayIso,
            cards: { calendar: feeds },
          }}
        />
      ) : null}
      <div className="space-y-5">
        {error ? (
          <Card className="border-destructive/40">
            <CardContent className="p-4 text-sm text-destructive">{error}</CardContent>
          </Card>
        ) : null}

        <CalendarSection entries={feeds.mine} allEntries={feeds.all} todayIso={todayIso} locale={profile.locale} />
      </div>
    </AppShell>
  );
}

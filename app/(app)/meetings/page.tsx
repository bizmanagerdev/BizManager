import AppShell from "@/components/layout/AppShell";
import { requireStaffPage } from "@/lib/auth/roleAccess";
import { israelDateKey } from "@/lib/timezone";
import {
  loadAssignableUsers,
  loadMeetingItems,
  loadMeetings,
  loadMeetingTasks,
} from "@/lib/meetings/load";
import { loadWeekStats, shiftDateKey } from "@/lib/meetings/stats";
import MeetingClient from "./MeetingClient";
import OpenMeetingCard from "./OpenMeetingCard";

// ישיבה שבועית — the weekly office meeting, run from this page.
//
// Always fresh: it is a live checklist several people tick at once on a shared
// screen, so a cached render would show a box someone already ticked as empty.
export const revalidate = 0;

export default async function MeetingsPage() {
  const { profile, supabase } = await requireStaffPage();

  const [meetings, users] = await Promise.all([loadMeetings(supabase, 60), loadAssignableUsers(supabase)]);

  const current = meetings[0] ?? null;
  const previous = meetings[1] ?? null;
  const today = israelDateKey();

  const shell = (children: React.ReactNode) => (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <div className="space-y-4 text-right" dir="rtl">
        {children}
      </div>
    </AppShell>
  );

  if (!current) {
    return shell(
      <>
        <div>
          <h1 className="text-lg font-bold">ישיבה שבועית</h1>
          <p className="text-xs text-muted-foreground">עדיין לא נפתחה ישיבה.</p>
        </div>
        <OpenMeetingCard
          suggestedDate={today}
          suggestedNextDate={shiftDateKey(today, 7)}
          previousMeetingDate={null}
          isFirst
        />
      </>
    );
  }

  const [items, previousTasks] = await Promise.all([
    loadMeetingItems(supabase, current.id),
    previous ? loadMeetingTasks(supabase, previous.id) : Promise.resolve([]),
  ]);

  // An open meeting shows live numbers (it is happening now, and the morning's
  // collection can land mid-meeting); a closed one shows the numbers it was
  // closed with, frozen on the row. Recomputing a closed meeting would quietly
  // rewrite history every time someone opened it.
  const stats =
    current.status === "closed" && current.stats
      ? current.stats
      : await loadWeekStats(supabase, {
          toKey: current.meetingDate,
          // The period is everything since the last meeting — a skipped
          // fortnight is covered, not lost between the two.
          previousMeetingKey: previous?.meetingDate ?? null,
          collectionTarget: previous?.collectionTarget ?? null,
          previousStats: previous?.stats ?? null,
        });

  return shell(
    <>
      {/* The last meeting is closed: the next one is the thing to do here, so
          it leads — the closed one stays below, readable but not editable. */}
      {current.status === "closed" ? (
        <OpenMeetingCard
          suggestedDate={
            current.nextMeetingDate && current.nextMeetingDate > current.meetingDate
              ? current.nextMeetingDate
              : shiftDateKey(current.meetingDate, 7)
          }
          suggestedNextDate={shiftDateKey(
            current.nextMeetingDate && current.nextMeetingDate > current.meetingDate
              ? current.nextMeetingDate
              : shiftDateKey(current.meetingDate, 7),
            7
          )}
          previousMeetingDate={current.meetingDate}
          isFirst={false}
        />
      ) : null}

      <MeetingClient
        meeting={current}
        items={items}
        stats={stats}
        previousMeetingDate={previous?.meetingDate ?? null}
        previousTasks={previousTasks}
        users={users}
        currentUserId={profile.id}
        viewerRole={profile.role}
      />
    </>
  );
}

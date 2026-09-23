import Link from "next/link";
import { notFound } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { ArrowRightIcon } from "@/components/ui/icons";
import { requireStaffPage } from "@/lib/auth/roleAccess";
import { canSeeMeetings } from "@/lib/auth/meetingsPreview";
import {
  loadAssignableUsers,
  loadMeetingById,
  loadMeetingItems,
  loadMeetingTasks,
  loadPreviousMeeting,
} from "@/lib/meetings/load";
import { loadWeekStats } from "@/lib/meetings/stats";
import MeetingClient from "../MeetingClient";

export const revalidate = 0;

// One meeting from the history, opened read-only. The same component as the
// live page renders it — a past meeting should look like the meeting it was,
// not like a different screen that happens to hold the same words.

export default async function MeetingRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { profile, supabase } = await requireStaffPage();
  // TEMPORARY trial gate — see lib/auth/meetingsPreview.ts. notFound() rather
  // than /no-access: while the page is one person's, it should look like it
  // isn't there at all, not like a door someone is being kept out of.
  if (!canSeeMeetings(profile.email)) notFound();

  const meeting = await loadMeetingById(supabase, id);
  if (!meeting) notFound();

  const previous = await loadPreviousMeeting(supabase, meeting.meetingDate);
  const [items, previousTasks, users] = await Promise.all([
    loadMeetingItems(supabase, meeting.id),
    previous ? loadMeetingTasks(supabase, previous.id) : Promise.resolve([]),
    loadAssignableUsers(supabase),
  ]);

  // Prefer the numbers frozen on the row. An older meeting that predates the
  // snapshot (or one closed before stats were stored) gets them recomputed for
  // its own period — still that period, just calculated now.
  const stats =
    meeting.stats ??
    (await loadWeekStats(supabase, {
      toKey: meeting.meetingDate,
      previousMeetingKey: previous?.meetingDate ?? null,
      collectionTarget: previous?.collectionTarget ?? null,
      previousStats: previous?.stats ?? null,
    }));

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <div className="space-y-4 text-right" dir="rtl">
        <Button asChild size="sm" variant="outline">
          <Link href="/meetings/history">
            <ArrowRightIcon />
            חזרה להיסטוריה
          </Link>
        </Button>
        <MeetingClient
          meeting={meeting}
          items={items}
          stats={stats}
          previousMeetingDate={previous?.meetingDate ?? null}
          previousTasks={previousTasks}
          users={users}
          currentUserId={profile.id}
          viewerRole={profile.role}
          readOnly
        />
      </div>
    </AppShell>
  );
}

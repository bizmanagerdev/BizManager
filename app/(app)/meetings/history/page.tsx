import Link from "next/link";
import { notFound } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { MetaRow } from "@/components/ui/meta-row";
import { SectionCard } from "@/components/ui/section-card";
import { ArrowRightIcon, ChecklistIcon, HistoryIcon } from "@/components/ui/icons";
import { requireStaffPage } from "@/lib/auth/roleAccess";
import { canSeeMeetings } from "@/lib/auth/meetingsPreview";
import { getStatusColorClasses } from "@/lib/ui/status-color-classes";
import { loadMeetings } from "@/lib/meetings/load";
import { cn } from "@/lib/utils";

export const revalidate = 0;

type Row = Record<string, unknown>;

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("he-IL", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default async function MeetingsHistoryPage() {
  const { profile, supabase } = await requireStaffPage();
  // TEMPORARY trial gate — see lib/auth/meetingsPreview.ts. notFound() rather
  // than /no-access: while the page is one person's, it should look like it
  // isn't there at all, not like a door someone is being kept out of.
  if (!canSeeMeetings(profile.email)) notFound();
  const meetings = await loadMeetings(supabase, 60);

  // One round trip for every meeting's tally, aggregated here — PostgREST has
  // no GROUP BY, and 60 meetings' worth of items is a few hundred narrow rows.
  const ids = meetings.map((m) => m.id);
  const counts = new Map<string, { done: number; total: number }>();
  const taskCounts = new Map<string, number>();
  if (ids.length > 0) {
    const [itemsResult, tasksResult] = await Promise.all([
      supabase.from("meeting_items").select("meeting_id,is_done,kind").in("meeting_id", ids),
      supabase.from("meeting_task_links").select("meeting_id").in("meeting_id", ids),
    ]);
    for (const row of ((itemsResult.data ?? []) as Row[])) {
      if (row.kind !== "agenda") continue;
      const id = typeof row.meeting_id === "string" ? row.meeting_id : null;
      if (!id) continue;
      const entry = counts.get(id) ?? { done: 0, total: 0 };
      entry.total += 1;
      if (row.is_done === true) entry.done += 1;
      counts.set(id, entry);
    }
    for (const row of ((tasksResult.data ?? []) as Row[])) {
      const id = typeof row.meeting_id === "string" ? row.meeting_id : null;
      if (!id) continue;
      taskCounts.set(id, (taskCounts.get(id) ?? 0) + 1);
    }
  }

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <div className="space-y-4 text-right" dir="rtl">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-bold">היסטוריית ישיבות</h1>
            <p className="text-xs text-muted-foreground">ישיבות שנרשמו במערכת, מהחדשה לישנה.</p>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link href="/meetings">
              <ArrowRightIcon />
              לישיבה הנוכחית
            </Link>
          </Button>
        </div>

        <SectionCard icon={<HistoryIcon className="h-4 w-4" />} title="ישיבות">
          {meetings.length === 0 ? (
            <EmptyState icon={<HistoryIcon className="h-6 w-6" />} dense>
              עדיין לא נרשמו ישיבות.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/60">
              {meetings.map((meeting) => {
                const tally = counts.get(meeting.id) ?? { done: 0, total: 0 };
                const tasks = taskCounts.get(meeting.id) ?? 0;
                const complete = tally.total > 0 && tally.done === tally.total;
                return (
                  <li key={meeting.id}>
                    <Link
                      href={`/meetings/${meeting.id}`}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-card/60 px-3 py-3 transition-colors hover:bg-secondary/5"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold">{formatDate(meeting.meetingDate)}</span>
                        <MetaRow
                          className="text-xs text-muted-foreground"
                          items={[
                            meeting.status === "closed" ? "סגורה" : "פתוחה",
                            tasks > 0 ? `${tasks} משימות נפתחו` : null,
                            meeting.collectionTarget
                              ? `יעד גבייה ${Math.round(meeting.collectionTarget).toLocaleString("he-IL")} ₪`
                              : null,
                          ]}
                        />
                      </span>
                      <span
                        className={cn(
                          "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
                          complete ? getStatusColorClasses("success") : getStatusColorClasses("info")
                        )}
                      >
                        <ChecklistIcon className="h-3.5 w-3.5" />
                        {tally.done} / {tally.total}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>
      </div>
    </AppShell>
  );
}

import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { toHebrewError } from "@/lib/error-messages";
import { loadMeetingItems, loadPreviousMeeting, loadTemplates } from "@/lib/meetings/load";
import { loadWeekStats } from "@/lib/meetings/stats";

// Opening a weekly meeting. On the server because it is four tables in one
// gesture: read the agenda, read the previous meeting, freeze the period's
// numbers, and write the meeting plus one item per agenda row. Everything else
// the page does (ticking an item, a note, the target, closing) is a single-table
// write the client makes straight against Supabase under RLS.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    const body = (await req.json().catch(() => ({}))) as {
      meeting_date?: string;
      next_meeting_date?: string | null;
    };

    const meetingDate = typeof body.meeting_date === "string" ? body.meeting_date.trim() : "";
    if (!ISO_DATE.test(meetingDate)) {
      return NextResponse.json({ error: "תאריך הישיבה חסר או לא תקין." }, { status: 400 });
    }
    const nextMeetingDate =
      typeof body.next_meeting_date === "string" && ISO_DATE.test(body.next_meeting_date.trim())
        ? body.next_meeting_date.trim()
        : null;

    // Already opened (two people pressed the button, or a double tap): hand back
    // the existing one rather than failing on the unique index.
    const { data: existing } = await supabase
      .from("meetings")
      .select("id")
      .eq("meeting_date", meetingDate)
      .maybeSingle();
    if (existing && typeof (existing as Record<string, unknown>).id === "string") {
      return NextResponse.json({ ok: true, id: (existing as Record<string, unknown>).id, existed: true });
    }

    const previous = await loadPreviousMeeting(supabase, meetingDate);
    const [templates, stats, previousItems] = await Promise.all([
      loadTemplates(supabase, { activeOnly: true }),
      // The period runs from the previous meeting to this one, and the goal for
      // it was set at that previous meeting — that is what "נגבה vs היעד"
      // compares against.
      loadWeekStats(supabase, {
        toKey: meetingDate,
        previousMeetingKey: previous?.meetingDate ?? null,
        collectionTarget: previous?.collectionTarget ?? null,
        previousStats: previous?.stats ?? null,
      }),
      previous ? loadMeetingItems(supabase, previous.id) : Promise.resolve([]),
    ]);

    if (templates.length === 0) {
      return NextResponse.json(
        { error: "אין סעיפים מוגדרים לישיבה. יש להוסיף סעיפים בהגדרות הישיבה." },
        { status: 400 }
      );
    }

    const { data: created, error: createError } = await supabase
      .from("meetings")
      .insert({
        meeting_date: meetingDate,
        status: "open",
        stats,
        next_meeting_date: nextMeetingDate,
        created_by: profile.id,
      })
      .select("id")
      .single();

    if (createError || !created) {
      return NextResponse.json(
        { error: toHebrewError(createError?.message ?? "", "פתיחת הישיבה נכשלה") },
        { status: 400 }
      );
    }
    const meetingId = (created as Record<string, unknown>).id as string;

    // What was left unchecked last week, by the template it came from, so the
    // copy below can mark the matching row as carried over.
    const unfinishedByTemplate = new Map<string, string>();
    for (const item of previousItems) {
      if (item.isDone || !item.templateId) continue;
      unfinishedByTemplate.set(item.templateId, item.meetingId);
    }

    type ItemRow = {
      meeting_id: string;
      template_id: string | null;
      kind: string;
      position: number;
      title: string;
      subpoints: string[];
      link_href: string | null;
      link_label: string | null;
      auto_source: string | null;
      assigned_user_id: string | null;
      carried_over_from: string | null;
    };

    const rows: ItemRow[] = templates.map((template) => ({
      meeting_id: meetingId,
      template_id: template.id,
      kind: template.kind,
      position: template.position,
      // Copied, not joined: rewriting the agenda next month must not rewrite
      // what this meeting said.
      title: template.title,
      subpoints: template.subpoints,
      link_href: template.linkHref,
      link_label: template.linkLabel,
      auto_source: template.autoSource,
      assigned_user_id: template.kind === "prep" ? template.defaultAssigneeId : null,
      carried_over_from: unfinishedByTemplate.get(template.id) ?? null,
    }));

    // Items added by hand last week (no template behind them) and left
    // unchecked come across too — otherwise a one-off "chase the insurer" item
    // would silently vanish the moment the next meeting opened.
    for (const item of previousItems) {
      if (item.isDone || item.templateId) continue;
      rows.push({
        meeting_id: meetingId,
        template_id: null,
        kind: item.kind,
        position: item.position,
        title: item.title,
        subpoints: item.subpoints,
        link_href: item.linkHref,
        link_label: item.linkLabel,
        auto_source: item.autoSource,
        assigned_user_id: item.assignedUserId,
        carried_over_from: item.meetingId,
      });
    }

    const { error: itemsError } = await supabase.from("meeting_items").insert(rows);
    if (itemsError) {
      // A meeting with no agenda is worse than no meeting: undo rather than
      // leave a half-built one on the date, which the unique index would then
      // block from being opened properly.
      await supabase.from("meetings").delete().eq("id", meetingId);
      return NextResponse.json(
        { error: toHebrewError(itemsError.message, "יצירת סעיפי הישיבה נכשלה") },
        { status: 400 }
      );
    }

    return NextResponse.json({ ok: true, id: meetingId, existed: false });
  } catch (err: unknown) {
    return NextResponse.json({ error: toHebrewError(err, "Unknown error") }, { status: 500 });
  }
}

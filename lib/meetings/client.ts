"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { toHebrewError } from "@/lib/error-messages";
import type { MeetingItemKind, MeetingTemplate } from "@/lib/meetings/types";

// The single-table writes ישיבה שבועית makes straight against Supabase under
// RLS, per the hybrid direct-Supabase policy — ticking an item, a note, an
// assignee, the week's target, closing the meeting, editing the agenda. The one
// write that does NOT live here is opening a meeting: that is four tables at
// once, so it stays a server route (app/api/meetings/open).

export type MeetingItemPatch = {
  is_done?: boolean;
  done_by?: string | null;
  done_at?: string | null;
  assigned_user_id?: string | null;
  notes?: string | null;
};

function client() {
  return createSupabaseBrowserClient();
}

/** Throws a Hebrew Error on failure, so every caller can just try/catch + toast. */
function raise(message: string | undefined, fallback: string): never {
  throw new Error(toHebrewError(message ?? "", fallback));
}

export async function patchMeetingItem(id: string, patch: MeetingItemPatch): Promise<void> {
  const { error } = await client()
    .from("meeting_items")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) raise(error.message, "עדכון הסעיף נכשל");
}

export async function setMeetingItemDone(
  id: string,
  done: boolean,
  currentUserId: string | null
): Promise<{ doneAt: string | null }> {
  const doneAt = done ? new Date().toISOString() : null;
  await patchMeetingItem(id, {
    is_done: done,
    // Cleared on un-tick: "מי סימן" about a box that is no longer ticked is
    // stale information, not history — the history lives in the closed meeting.
    done_by: done ? currentUserId : null,
    done_at: doneAt,
  });
  return { doneAt };
}

export type MeetingPatch = {
  notes?: string | null;
  collection_target?: number | null;
  next_meeting_date?: string | null;
  status?: "open" | "closed";
  closed_at?: string | null;
  closed_by?: string | null;
  stats?: unknown;
};

export async function patchMeeting(id: string, patch: MeetingPatch): Promise<void> {
  const { error } = await client()
    .from("meetings")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) raise(error.message, "עדכון הישיבה נכשל");
}

export async function linkTaskToMeeting(args: {
  meetingId: string;
  meetingItemId: string | null;
  taskId: string;
}): Promise<void> {
  const { error } = await client().from("meeting_task_links").insert({
    meeting_id: args.meetingId,
    meeting_item_id: args.meetingItemId,
    task_id: args.taskId,
  });
  if (error) raise(error.message, "שיוך המשימה לישיבה נכשל");
}

/** A one-off item added during the meeting — no template behind it. */
export async function addAdHocItem(args: {
  meetingId: string;
  kind: MeetingItemKind;
  title: string;
  position: number;
}): Promise<string> {
  const { data, error } = await client()
    .from("meeting_items")
    .insert({
      meeting_id: args.meetingId,
      kind: args.kind,
      title: args.title,
      position: args.position,
    })
    .select("id")
    .single();
  // .insert().select() needs a SELECT policy as well as INSERT — staff have
  // both (the "Staff can manage" FOR ALL policy covers it).
  if (error || !data) raise(error?.message, "הוספת הסעיף נכשלה");
  return (data as Record<string, unknown>).id as string;
}

export async function deleteMeetingItem(id: string): Promise<void> {
  const { error } = await client().from("meeting_items").delete().eq("id", id);
  if (error) raise(error.message, "מחיקת הסעיף נכשלה");
}

// ── The agenda itself (settings view) ───────────────────────────────────────

export type TemplateDraft = {
  kind: MeetingItemKind;
  position: number;
  title: string;
  subpoints: string[];
  link_href: string | null;
  link_label: string | null;
  default_assignee_id: string | null;
  is_active: boolean;
};

export async function createTemplate(draft: TemplateDraft): Promise<MeetingTemplate> {
  const { data, error } = await client().from("meeting_templates").insert(draft).select("*").single();
  if (error || !data) raise(error?.message, "הוספת הסעיף נכשלה");
  const row = data as Record<string, unknown>;
  return {
    id: row.id as string,
    kind: draft.kind,
    position: draft.position,
    title: draft.title,
    subpoints: draft.subpoints,
    linkHref: draft.link_href,
    linkLabel: draft.link_label,
    defaultAssigneeId: draft.default_assignee_id,
    autoSource: null,
    isActive: draft.is_active,
  };
}

export async function updateTemplate(id: string, patch: Partial<TemplateDraft>): Promise<void> {
  const { error } = await client()
    .from("meeting_templates")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) raise(error.message, "עדכון הסעיף נכשל");
}

export async function deleteTemplate(id: string): Promise<void> {
  const { error } = await client().from("meeting_templates").delete().eq("id", id);
  if (error) raise(error.message, "מחיקת הסעיף נכשלה");
}

/** Persist a whole reordered list in one round trip per row. */
export async function reorderTemplates(ordered: { id: string; position: number }[]): Promise<void> {
  const supabase = client();
  const results = await Promise.all(
    ordered.map(({ id, position }) =>
      supabase.from("meeting_templates").update({ position, updated_at: new Date().toISOString() }).eq("id", id)
    )
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) raise(failed.error.message, "שינוי הסדר נכשל");
}

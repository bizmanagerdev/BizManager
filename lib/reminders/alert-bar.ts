import type { SupabaseClient } from "@supabase/supabase-js";
import { getInboxView, ruleKeyOf, type WorklistSeverity } from "@/lib/reminders/worklist";

// The shared AlertBar's read model — sits on top of getInboxView (the same one
// backing /inbox and the top-bar bell), scoped to system-detected problems only.
// Manual reminders are personal and have no natural "module", so they stay
// inbox/bell-only, matching what the old per-page PageAlertBar wired (it never
// listed a "reminders" key either).

export type AlertLevel = WorklistSeverity;

export type SystemAlert = {
  /** `${entityType}:${entityId}:${ruleKey}` — stable across however many `reminders`
   *  rows describe the same real-world thing (e.g. a fan-out to several recipients),
   *  so callers can dedupe on it directly. */
  id: string;
  level: AlertLevel;
  title: string;
  entityType: string;
  entityId: string;
  href: string;
  /** ISO, or null. Real for manual reminders (their own remind_at IS the due date);
   *  system rows don't carry a structured due date today (see worklist.ts), so this
   *  is null for them — their due-date phrasing already lives in the alert's title. */
  dueAt: string | null;
  /** The alert's home page/section, derived from its own href. */
  module: string;
  /** The underlying reminders.id row(s) this alert represents — usually one, but a
   *  rule fanned out to several recipients can back one deduped alert with more than
   *  one row. Row actions (done/dismiss/snooze) must act on all of them, or a
   *  "resolved" alert can silently reappear from a row the action didn't reach. */
  reminderIds: string[];
};

function moduleOf(href: string): string {
  const path = href.split(/[?#]/)[0] ?? href;
  return path.split("/").filter(Boolean)[0] || "other";
}

export async function getAlertBarAlerts(
  supabase: SupabaseClient,
  options: { userId: string; role: string | null }
): Promise<SystemAlert[]> {
  const inbox = await getInboxView(supabase, options);
  const byId = new Map<string, SystemAlert>();

  for (const item of inbox.items) {
    if (item.source !== "system") continue;
    const id = `${item.entityType}:${item.entityId}:${ruleKeyOf(item)}`;
    // Dedupe: a rule fanned out to several recipients can put more than one
    // `reminders` row on the same entity — they all resolve to the same id here, so
    // the entity only ever counts/shows once, but every backing row is kept so a
    // row action (done/dismiss/snooze) can resolve all of them, not just the first.
    const existing = byId.get(id);
    if (existing) {
      existing.reminderIds.push(item.id);
      continue;
    }
    byId.set(id, {
      id,
      level: item.severity,
      title: item.title,
      entityType: item.entityType,
      entityId: item.entityId,
      href: item.url,
      dueAt: null,
      module: moduleOf(item.url),
      reminderIds: [item.id],
    });
  }

  // Collapsed rule summaries (low_stock, collection_overdue, …) stand for many
  // underlying reminders — there's no single row action for "17 overdue debts", so
  // they carry no reminderIds; the strip only links them out, it doesn't act on them.
  for (const summary of inbox.summaries) {
    const id = `summary:${summary.ruleKey}:${summary.ruleKey}`;
    if (byId.has(id)) continue;
    byId.set(id, {
      id,
      level: summary.severity,
      title: summary.title,
      entityType: "summary",
      entityId: summary.ruleKey,
      href: summary.href,
      dueAt: null,
      module: moduleOf(summary.href),
      reminderIds: [],
    });
  }

  return [...byId.values()];
}

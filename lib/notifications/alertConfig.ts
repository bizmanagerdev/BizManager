import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { AlertRow } from "@/lib/notifications/types";

/** RLS ("push_alert_config_admin_full") matches the old routes' admin-only gate exactly. */
export async function fetchAlertConfigs(): Promise<AlertRow[]> {
  const { data, error } = await createSupabaseBrowserClient()
    .from("push_alert_config")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) return [];
  return (data ?? []) as AlertRow[];
}

export async function createAlertConfig(input: Partial<AlertRow>): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!input.title?.trim()) return { ok: false, error: "title required" };
  const { data, error } = await createSupabaseBrowserClient()
    .from("push_alert_config")
    .insert({
      title: input.title.trim(),
      body: input.body ?? "",
      url: input.url ?? "/inbox",
      alert_type: input.alert_type ?? null,
      enabled: input.enabled ?? true,
      send_hour_israel: input.send_hour_israel ?? 8,
      schedule: input.schedule ?? "daily",
      recipient_user_ids: input.recipient_user_ids ?? [],
      sort_order: input.sort_order ?? 0,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data.id };
}

const PATCHABLE_KEYS = [
  "title", "body", "url", "enabled", "send_hour_israel", "schedule",
  "recipient_user_ids", "sort_order", "audience_role", "send_hour_end_israel",
] as const;

export async function updateAlertConfig(id: string, patch: Partial<AlertRow>): Promise<boolean> {
  const update: Partial<AlertRow> = {};
  for (const key of PATCHABLE_KEYS) {
    if (patch[key] !== undefined) (update as Record<string, unknown>)[key] = patch[key];
  }
  const { error } = await createSupabaseBrowserClient().from("push_alert_config").update(update).eq("id", id);
  return !error;
}

export async function deleteAlertConfig(id: string): Promise<boolean> {
  const { error } = await createSupabaseBrowserClient().from("push_alert_config").delete().eq("id", id);
  return !error;
}

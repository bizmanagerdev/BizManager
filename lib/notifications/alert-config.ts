import type { SupabaseClient } from "@supabase/supabase-js";

// Readers for the unified alert registry (push_alert_config). Tolerant of the
// new columns not existing yet (pre-migration) — callers then fall back to the
// hardcoded defaults, so nothing breaks before the migration runs.

export type RuleSetting = { enabled: boolean; audienceRole: string | null };
export type NightlyConfig = { enabled: boolean; startHour: number; endHour: number; audienceRole: string };

/** enabled + audience for every live/night rule, keyed by rule_key. */
export async function getRuleSettings(supabase: SupabaseClient): Promise<Map<string, RuleSetting>> {
  const map = new Map<string, RuleSetting>();
  const { data, error } = await supabase
    .from("push_alert_config")
    .select("rule_key,enabled,audience_role")
    .not("rule_key", "is", null);
  if (error || !data) return map; // pre-migration / no config → no overrides
  for (const r of data as Array<{ rule_key?: string | null; enabled?: boolean | null; audience_role?: string | null }>) {
    if (!r.rule_key) continue;
    map.set(r.rule_key, {
      enabled: r.enabled !== false,
      audienceRole: typeof r.audience_role === "string" && r.audience_role ? r.audience_role : null,
    });
  }
  return map;
}

/** The nightly-review window + on/off + audience (falls back to 23:00–01:00 / office). */
export async function getNightlyConfig(supabase: SupabaseClient): Promise<NightlyConfig> {
  const fallback: NightlyConfig = { enabled: true, startHour: 23, endHour: 1, audienceRole: "office" };
  const { data, error } = await supabase
    .from("push_alert_config")
    .select("enabled,send_hour_israel,send_hour_end_israel,audience_role")
    .eq("rule_key", "nightly_review")
    .maybeSingle();
  if (error || !data) return fallback;
  const d = data as {
    enabled?: boolean | null;
    send_hour_israel?: number | null;
    send_hour_end_israel?: number | null;
    audience_role?: string | null;
  };
  return {
    enabled: d.enabled !== false,
    startHour: typeof d.send_hour_israel === "number" ? d.send_hour_israel : 23,
    endHour: typeof d.send_hour_end_israel === "number" ? d.send_hour_end_israel : 1,
    audienceRole: typeof d.audience_role === "string" && d.audience_role ? d.audience_role : "office",
  };
}

/** Resolve an audience_role bucket to active users' AUTH ids (for push). */
export async function recipientsForAudience(supabase: SupabaseClient, audienceRole: string): Promise<string[]> {
  const { data } = await supabase.from("users").select("auth_user_id,role,active").eq("active", true);
  const rows = (data ?? []) as Array<{ auth_user_id?: string | null; role?: string | null }>;
  const wanted =
    audienceRole === "all"
      ? null // everyone
      : audienceRole === "admin"
        ? new Set(["admin"])
        : new Set(["office", "admin"]); // office bucket reaches office + admin
  return rows
    .filter((u) => !wanted || (u.role ? wanted.has(u.role) : false))
    .map((u) => u.auth_user_id)
    .filter((v): v is string => Boolean(v));
}

import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export type DunningStage = { day_offset: number; label: string; severity: string; enabled: boolean };

/** RLS ("Admin manage dunning stages") matches the old route's admin-only gate exactly. */
export async function fetchDunningStages(): Promise<DunningStage[]> {
  const { data, error } = await createSupabaseBrowserClient()
    .from("dunning_stages")
    .select("id,day_offset,label,severity,enabled,sort_order")
    .order("day_offset", { ascending: true });
  if (error) return [];
  return (data ?? []) as DunningStage[];
}

/** Replace the whole ladder — same delete-then-insert shape as the old route. */
export async function saveDunningStages(stages: DunningStage[]): Promise<boolean> {
  const supabase = createSupabaseBrowserClient();
  const sanitized = stages
    .filter((s) => Number.isFinite(Number(s.day_offset)) && typeof s.label === "string" && s.label.trim())
    .map((s, i) => ({
      day_offset: Math.max(0, Math.floor(Number(s.day_offset))),
      label: s.label.trim(),
      severity: ["info", "warning", "danger"].includes(s.severity) ? s.severity : "warning",
      enabled: s.enabled !== false,
      sort_order: i,
    }));

  const del = await supabase.from("dunning_stages").delete().not("id", "is", null);
  if (del.error) return false;
  if (sanitized.length > 0) {
    const ins = await supabase.from("dunning_stages").insert(sanitized);
    if (ins.error) return false;
  }
  return true;
}

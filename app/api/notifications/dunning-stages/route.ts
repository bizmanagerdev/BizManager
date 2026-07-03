import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { toHebrewError } from "@/lib/error-messages";

type StageInput = { day_offset?: number; label?: string; severity?: string; enabled?: boolean };

// GET — the dunning ladder (admin). PUT — replace the whole ladder.
export async function GET() {
  const access = await requireRouteAccess({ allowedRoles: ["admin"] });
  if (!access.ok) return access.response;
  const { supabase } = access.value;
  const { data, error } = await supabase
    .from("dunning_stages")
    .select("id,day_offset,label,severity,enabled,sort_order")
    .order("day_offset", { ascending: true });
  if (error) return NextResponse.json({ stages: [], error: toHebrewError(error.message) });
  return NextResponse.json({ stages: data ?? [] });
}

export async function PUT(req: Request) {
  const access = await requireRouteAccess({ allowedRoles: ["admin"] });
  if (!access.ok) return access.response;
  const { supabase } = access.value;

  const body = (await req.json().catch(() => ({}))) as { stages?: StageInput[] };
  const stages = (body.stages ?? [])
    .filter((s) => Number.isFinite(Number(s.day_offset)) && typeof s.label === "string" && s.label.trim())
    .map((s, i) => ({
      day_offset: Math.max(0, Math.floor(Number(s.day_offset))),
      label: (s.label as string).trim(),
      severity: ["info", "warning", "danger"].includes(s.severity ?? "") ? s.severity : "warning",
      enabled: s.enabled !== false,
      sort_order: i,
    }));

  // Replace the whole ladder.
  const del = await supabase.from("dunning_stages").delete().not("id", "is", null);
  if (del.error) return NextResponse.json({ error: toHebrewError(del.error.message) }, { status: 400 });
  if (stages.length > 0) {
    const ins = await supabase.from("dunning_stages").insert(stages);
    if (ins.error) return NextResponse.json({ error: toHebrewError(ins.error.message) }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import type { AlertRow } from "@/lib/notifications/types";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireRouteAccess({ allowedRoles: ["admin"] });
  if (!access.ok) return access.response;
  const { supabase } = access.value;
  const { id } = await params;

  const body = (await req.json()) as Partial<AlertRow>;

  const patch: Partial<AlertRow> = {};
  if (body.title !== undefined)             patch.title = body.title;
  if (body.body !== undefined)              patch.body = body.body;
  if (body.url !== undefined)               patch.url = body.url;
  if (body.enabled !== undefined)           patch.enabled = body.enabled;
  if (body.send_hour_israel !== undefined)  patch.send_hour_israel = body.send_hour_israel;
  if (body.schedule !== undefined)          patch.schedule = body.schedule;
  if (body.recipient_user_ids !== undefined) patch.recipient_user_ids = body.recipient_user_ids;
  if (body.sort_order !== undefined)        patch.sort_order = body.sort_order;

  const { error } = await supabase.from("push_alert_config").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: toHebrewError(error.message) }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireRouteAccess({ allowedRoles: ["admin"] });
  if (!access.ok) return access.response;
  const { supabase } = access.value;
  const { id } = await params;

  const { error } = await supabase.from("push_alert_config").delete().eq("id", id);
  if (error) return NextResponse.json({ error: toHebrewError(error.message) }, { status: 500 });
  return NextResponse.json({ ok: true });
}

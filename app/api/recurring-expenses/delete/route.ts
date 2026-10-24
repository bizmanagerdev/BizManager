import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { toHebrewError } from "@/lib/error-messages";

// A recurring bill deleted through the send queue, so it deletes with no signal too (owner, 2026-10-24 — the
// property page's "הוצאות קבועות"). The same rule as lib/recurring/deleteTemplate.ts: admins and office (RLS
// "Admins and office can manage recurring expense templates"). One already gone is done.

export async function POST(req: Request) {
  const access = await requireRouteAccess({
    allowedRoles: ["admin", "office"],
  });
  if (!access.ok) return access.response;
  const { supabase } = access.value;

  const body = (await req.json().catch(() => ({}))) as { id?: unknown };
  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const { error } = await supabase
    .from("recurring_expense_templates")
    .delete()
    .eq("id", id);
  if (error)
    return NextResponse.json(
      { error: toHebrewError(error.message) },
      { status: 400 },
    );
  return NextResponse.json({ ok: true });
}

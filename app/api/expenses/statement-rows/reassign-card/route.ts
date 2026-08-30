import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

// Bulk-moves a whole phantom "card" group onto its real card — the cleanup
// tool for the case a row's freely-editable category was retyped (e.g. "ויזה
// 9557 - דלק") and got mistaken for a brand-new card everywhere card_label
// groups rows (חיוב כרטיס בחשבון / הכנסה מכרטיס / the payments calendar).
// card_label lives ONLY on card_statement_rows (never mirrored onto
// `expenses`), so this is a single bulk update — no per-row expense sync
// needed, unlike an ordinary category edit. Admin/office.
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { row_ids?: unknown; card_label?: unknown };
    const rowIds = Array.isArray(body.row_ids)
      ? body.row_ids.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
      : [];
    const cardLabel = typeof body.card_label === "string" ? body.card_label.trim() : "";
    if (rowIds.length === 0) return NextResponse.json({ error: "לא נבחרו שורות למיזוג." }, { status: 400 });
    if (!cardLabel) return NextResponse.json({ error: "יש לבחור כרטיס יעד." }, { status: 400 });

    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    const { error } = await supabase.from("card_statement_rows").update({ card_label: cardLabel }).in("id", rowIds);
    if (error) return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });

    return NextResponse.json({ ok: true, updated: rowIds.length });
  } catch (err: unknown) {
    const message = toHebrewError(err, "מיזוג הכרטיס נכשל.");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

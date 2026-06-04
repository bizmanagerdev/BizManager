import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

// Toggles a statement's "marked_done" flag. Use it for a statement that's already been
// handled manually (e.g. its expenses were entered before this feature) so it stops
// triggering the "פירוטי אשראי לא משויכים" alert and shows a "בוצע" status. Admin/office.
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { statement_id?: string; done?: boolean };
    const statementId = typeof body.statement_id === "string" ? body.statement_id.trim() : "";
    if (!statementId) return NextResponse.json({ error: "חסר מזהה פירוט." }, { status: 400 });
    const done = body.done !== false; // default to marking done

    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    const { error } = await supabase
      .from("card_statements")
      .update({ marked_done: done })
      .eq("id", statementId);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ ok: true, marked_done: done });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "עדכון הסטטוס נכשל.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

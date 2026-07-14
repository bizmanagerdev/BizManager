import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { toHebrewError } from "@/lib/error-messages";

type CreateTagPayload = {
  name?: string;
  kind?: string;
  color?: string | null;
};

// A fixed allow-list of tag kinds that may be created inline from a picker.
// 'vehicle' stays owned by the vehicles flow (it also creates a detail row), so
// it is intentionally excluded here.
const CREATABLE_KINDS = new Set(["general", "campaign", "vendor"]);

// Create a lightweight label tag (e.g. a customer segment) on the fly.
export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase, user } = access.value;

    const body = (await req.json()) as CreateTagPayload;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const kind = typeof body.kind === "string" && CREATABLE_KINDS.has(body.kind) ? body.kind : "general";
    const color = typeof body.color === "string" && body.color.trim() ? body.color.trim() : null;

    if (!name) {
      return NextResponse.json({ error: "יש להזין שם תגית." }, { status: 400 });
    }

    // Reuse an existing active tag of the same kind+name (case-sensitive match on
    // the trimmed name) so the same label isn't duplicated every time it's typed.
    const { data: existing } = await supabase
      .from("tags")
      .select("id,kind,name,color")
      .eq("kind", kind)
      .eq("name", name)
      .eq("is_active", true)
      .maybeSingle();
    if (existing) return NextResponse.json({ tag: existing });

    const { data, error } = await supabase
      .from("tags")
      .insert({ kind, name, color, created_by: user.id })
      .select("id,kind,name,color")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: toHebrewError(error.message, "יצירת תגית נכשלה.") }, { status: 400 });
    }
    if (!data) {
      return NextResponse.json({ error: "תגית לא נוצרה." }, { status: 500 });
    }

    return NextResponse.json({ tag: data });
  } catch (err: unknown) {
    return NextResponse.json({ error: toHebrewError(err, "שגיאה לא ידועה") }, { status: 500 });
  }
}

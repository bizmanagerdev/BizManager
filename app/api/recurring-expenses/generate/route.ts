import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

function looksLikeMissingSchema(message: string) {
  const value = message.toLowerCase();
  return value.includes("does not exist") || value.includes("could not find") || value.includes("schema cache");
}

export async function POST() {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    const todayIso = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase.rpc("generate_recurring_expenses_for_date", {
      p_today: todayIso,
    });

    if (error) {
      if (looksLikeMissingSchema(error.message)) {
        return NextResponse.json({ error: "Missing recurring expense schema" }, { status: 400 });
      }
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      createdCount:
        typeof data === "number" ? data : typeof data === "string" ? Number(data) || 0 : 0,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

const isIso = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

// Returns existing expenses within a date window so the importer can flag
// rows that already appear in the system (matched on amount + date proximity).
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { from?: string; to?: string };
    const from = typeof body.from === "string" ? body.from.trim() : "";
    const to = typeof body.to === "string" ? body.to.trim() : "";
    if (!isIso(from) || !isIso(to)) {
      return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
    }

    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    const { data, error } = await supabase
      .from("expenses")
      .select("expense_date,amount,description")
      .gte("expense_date", from)
      .lte("expense_date", to)
      .limit(5000);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ expenses: data ?? [] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

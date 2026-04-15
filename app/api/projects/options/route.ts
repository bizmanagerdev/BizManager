import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

type ProjectOptionRow = {
  id: string;
  name: string | null;
};

export async function GET() {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    const { data, error } = await supabase
      .from("project_dashboard_view")
      .select("id,name")
      .order("name", { ascending: true })
      .range(0, 999);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const projects = ((data ?? []) as ProjectOptionRow[])
      .filter((row) => typeof row.id === "string" && row.id)
      .map((row) => ({
        id: row.id,
        label: typeof row.name === "string" && row.name.trim() ? row.name.trim() : `Project ${row.id.slice(0, 8)}`,
      }));

    return NextResponse.json({ projects });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { ensureRecurringTasksForDate } from "@/lib/recurring-tasks";

export async function POST() {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    const result = await ensureRecurringTasksForDate(supabase);
    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? "Failed to generate recurring tasks" }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      created_count: result.createdCount,
      skipped_missing_schema: result.skippedMissingSchema,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


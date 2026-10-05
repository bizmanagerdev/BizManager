import { NextResponse } from "next/server";
import { toHebrewError } from "@/lib/error-messages";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { STAFF_ROLES } from "@/lib/auth/roleAccess";
import { loadProjectsPage } from "@/app/(app)/projects/loadProjects";
import { parseProjectsFilters } from "@/app/(app)/projects/projectsFilters";

// One page of the projects list — the same rows /projects renders, for the
// filters in the query string (read by the same parseProjectsFilters).
// ProjectsClient uses it to switch tabs and filters in the browser, and to
// load the other tabs in the background, instead of re-rendering the whole
// page on the server for each switch. A GET, not a server action: Next runs a
// page's server actions one at a time, and these background loads must not
// queue in front of a save. RLS checks every query against the caller's JWT.
export async function GET(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: STAFF_ROLES });
    if (!access.ok) return access.response;

    const url = new URL(req.url);
    const filters = parseProjectsFilters((key) => url.searchParams.get(key));
    const page = Math.max(1, Math.floor(Number(url.searchParams.get("page")) || 1));

    const result = await loadProjectsPage(access.value.supabase, { page, filters });
    if (result.error) return NextResponse.json({ error: result.error }, { status: 500 });
    return NextResponse.json(
      { rows: result.rows, hasMore: result.hasMore, totalCount: result.totalCount },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error: unknown) {
    return NextResponse.json({ error: toHebrewError(error, "טעינת הפרויקטים נכשלה.") }, { status: 500 });
  }
}

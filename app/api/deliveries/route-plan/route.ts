import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { hasDeliveriesAccess } from "@/lib/auth/roleAccess";
import { OptimizationError } from "@/lib/routes/route-optimization";
import { parseRoutePlanRequest, planRoute, RoutePlanError } from "@/lib/routes/plan-route";

// The delivery route planner (app/(app)/deliveries/route): the best order for
// the chosen stops, from Google's route planner with traffic. Whoever can see
// the deliveries can plan a route — drivers too. Every call is billed by
// Google, so signed-in people only, and only map points are sent to it.

// Google searches for a few seconds; three plans are asked at once.
export const maxDuration = 30;

export async function POST(req: Request) {
  const access = await requireRouteAccess();
  if (!access.ok) return access.response;
  if (!hasDeliveriesAccess(access.value.profile.role, access.value.profile.section_access)) {
    return NextResponse.json({ error: "No access" }, { status: 403 });
  }

  try {
    const request = parseRoutePlanRequest(await req.json().catch(() => null));
    return NextResponse.json(await planRoute(request));
  } catch (error) {
    if (error instanceof RoutePlanError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof OptimizationError) {
      return NextResponse.json(
        { error: error.message, setup: error.setup, unreachable: error.unreachable },
        { status: error.status }
      );
    }
    console.error("[route-plan]", error);
    return NextResponse.json({ error: "חישוב המסלול נכשל. נסו שוב בעוד רגע." }, { status: 500 });
  }
}

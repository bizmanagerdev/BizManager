import { NextResponse } from "next/server";
import { toHebrewError } from "@/lib/error-messages";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { loadOutflowSources } from "@/lib/outflow-sources";
import { loadInflowSources } from "@/lib/inflow-sources";

// The rows of "מקורות נוספים" (salaries / loan instalments / card charges with
// their settings). Fetched by the תשלומים קבועים tab when it opens, so the
// payments calendar page itself doesn't pay for loading every loan on each
// visit. Admin/office only, like the tab.

export async function GET() {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase } = access.value;
    const todayIso = new Date().toISOString().slice(0, 10);
    // Both halves of "what happens every month". Incoming is additive: if it
    // fails, the list is still the list it was.
    const [outgoing, incoming] = await Promise.all([
      loadOutflowSources(supabase, { todayIso }),
      loadInflowSources(supabase, { todayIso }).catch(() => []),
    ]);
    return NextResponse.json({ rows: [...outgoing, ...incoming], todayIso });
  } catch (err: unknown) {
    return NextResponse.json({ error: toHebrewError(err, "טעינת המקורות נכשלה.") }, { status: 500 });
  }
}

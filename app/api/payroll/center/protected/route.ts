import { toHebrewError } from "@/lib/error-messages";
import { NextRequest, NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import {
  fetchSalaryCenterProtectedPayload,
  isSalaryTrackedWorker,
  type SalaryCenterProtectedPayload,
} from "@/lib/payroll-center";

type UserScopeRow = {
  id: string;
  role: string | null;
  payroll_worker_type: "session_only" | "monthly_payslip" | "hourly_payslip" | null;
  pay_tracking_mode: "session" | "payslip" | null;
};

// Best-effort in-memory cache (per warm serverless instance). Keyed by viewer + scope so
// a worker-detail page can be revisited instantly. Short TTL + a `fresh=1` bypass keep
// financial numbers correct: every post-mutation reload (refreshAll) requests fresh data,
// which also overwrites the cached entry. Misses on a cold instance just recompute.
const CACHE_TTL_MS = 30_000;
const payloadCache = new Map<string, { expires: number; payload: SalaryCenterProtectedPayload }>();

function readCache(key: string): SalaryCenterProtectedPayload | null {
  const hit = payloadCache.get(key);
  if (!hit) return null;
  if (hit.expires <= cacheNow()) {
    payloadCache.delete(key);
    return null;
  }
  return hit.payload;
}

// performance.now() is monotonic and available in the route runtime (Date.now is fine too,
// but performance.now avoids clock-skew surprises). Wrapped so intent is clear.
function cacheNow() {
  return typeof performance !== "undefined" ? performance.now() : 0;
}

export async function GET(request: NextRequest) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;

    const { supabase, profile } = access.value;
    const requestedUserId = request.nextUrl.searchParams.get("userId")?.trim() || "";
    const skipCache = request.nextUrl.searchParams.get("fresh") === "1";
    const cacheKey = `${profile.id}:${requestedUserId || "all"}`;

    if (!skipCache) {
      const cached = readCache(cacheKey);
      if (cached) return NextResponse.json(cached);
    }

    // Worker-detail mode scopes the whole payload to one worker. Filtering every table/view
    // by a single user_id lets Postgres use its indexes instead of scanning all workers.
    const baseSelect = supabase
      .from("users")
      .select("id,role,active,payroll_worker_type,pay_tracking_mode")
      .eq("active", true);
    const usersResult = requestedUserId
      ? await baseSelect.eq("id", requestedUserId)
      : await baseSelect
          .or("role.eq.admin,role.eq.office,role.eq.worker,role.eq.worker_no_access")
          .range(0, 999);

    if (usersResult.error) {
      return NextResponse.json({ error: toHebrewError(usersResult.error.message) }, { status: 400 });
    }

    const allRows = (usersResult.data ?? []) as UserScopeRow[];
    // Office may view salaries only of users below them: worker & worker_no_access. The same
    // filter doubles as the access check for a scoped request — asking for an admin/office
    // user as office yields zero rows and therefore an empty (denied) payload.
    const rows =
      profile.role === "office"
        ? allRows.filter((row) => row.role === "worker" || row.role === "worker_no_access")
        : allRows;
    const userIds = rows.map((row) => row.id).filter(Boolean);
    const salaryTrackedUserIds = rows.filter((row) => isSalaryTrackedWorker(row)).map((row) => row.id).filter(Boolean);
    const payload = await fetchSalaryCenterProtectedPayload(supabase, userIds, salaryTrackedUserIds);

    payloadCache.set(cacheKey, { expires: cacheNow() + CACHE_TTL_MS, payload });
    return NextResponse.json(payload);
  } catch (error: unknown) {
    const message = toHebrewError(error, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

// Admin-only: fire a cron ON DEMAND for testing, bypassing its time gate. Maps a
// friendly name to the cron path (+ force) and self-invokes it with CRON_SECRET.
const TARGETS: Record<string, string> = {
  nightly: "/api/cron/nightly-review?force=true", // night alert, any time
  daily: "/api/cron/daily-alerts?force=true", // scheduled digests, any hour
  deliver: "/api/cron/reminders?force=true", // push due reminders, ignore quiet hours
  sync: "/api/cron/reminders-sync", // rebuild worklist system reminders
};

export async function POST(req: Request) {
  const access = await requireRouteAccess({ allowedRoles: ["admin"] });
  if (!access.ok) return access.response;

  const body = (await req.json().catch(() => ({}))) as { which?: string };
  const path = body.which ? TARGETS[body.which] : undefined;
  if (!path) return NextResponse.json({ error: "unknown target" }, { status: 400 });

  const host = req.headers.get("host") ?? "localhost:3000";
  const proto = host.startsWith("localhost") ? "http" : "https";
  const res = await fetch(`${proto}://${host}${path}`, {
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` },
  });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json({ which: body.which, status: res.status, result: data });
}

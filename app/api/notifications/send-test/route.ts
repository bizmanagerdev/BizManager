import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

export async function POST(req: Request) {
  const access = await requireRouteAccess({ allowedRoles: ["admin"] });
  if (!access.ok) return access.response;

  // Forward to the cron route (server-to-server, same process)
  const host = req.headers.get("host") ?? "localhost:3000";
  const proto = host.startsWith("localhost") ? "http" : "https";
  const cronSecret = process.env.CRON_SECRET ?? "";

  const res = await fetch(`${proto}://${host}/api/cron/daily-alerts?period=morning`, {
    headers: { Authorization: `Bearer ${cronSecret}` },
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

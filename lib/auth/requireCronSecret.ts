import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

// The scheduled jobs (vercel.json "crons") run with the service-role key, so
// each one must answer only Vercel's scheduler, which sends
// `Authorization: Bearer <CRON_SECRET>` once the project has CRON_SECRET set.
// Without the secret every call is refused — the routes used to skip the check
// then, and ran for anyone who called their address (audit, 2026-10-27).
export function requireCronSecret(
  req: Request,
): { ok: true } | { ok: false; response: NextResponse } {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return { ok: false, response: NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 }) };
  }

  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  return { ok: true };
}

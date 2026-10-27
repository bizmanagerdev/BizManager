import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/auth/requireCronSecret";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ensureRecentPayslips } from "@/lib/payroll-center";

// Daily: every payslip-tracked worker has this month's and last month's payslip,
// so pay day never starts with «יצירת תלוש». Runs just after midnight Israel time,
// so a new month's payslips exist from its first morning. See ensureRecentPayslips.
export async function GET(req: Request) {
  const cron = requireCronSecret(req);
  if (!cron.ok) return cron.response;

  const supabase = createSupabaseAdminClient();
  if (!supabase) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" }, { status: 500 });

  try {
    const result = await ensureRecentPayslips(supabase);
    return NextResponse.json({ ok: true, ...result });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}

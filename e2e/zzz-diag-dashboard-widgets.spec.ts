import { test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { getCollectionsSummary } from "@/lib/collections";
import { getInboxView } from "@/lib/reminders/worklist";
import { loadDomainCashBreakdown } from "@/lib/financial";
import { monthWindow } from "@/lib/dashboard/domain-chart";
import { getAdminUserId } from "./db";

// TEMPORARY DIAGNOSTIC — three dashboard widgets (collections, todayAlerts,
// domainChart) all wrap their data source in .catch(() => null), which
// silently hides the card on any error with no trace in the Playwright
// report (server console output isn't captured by webServer's default
// 'pipe' stdout mode). Calling the same functions directly here, against the
// same live CI Supabase stack, surfaces the real error via a normal test
// failure. Delete this file once the cause is found.
function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

test("diag: getCollectionsSummary", async () => {
  const todayIso = new Date().toISOString().slice(0, 10);
  await getCollectionsSummary(client(), todayIso);
});

test("diag: getInboxView", async () => {
  const adminId = await getAdminUserId();
  await getInboxView(client(), { userId: adminId, role: "admin" });
});

test("diag: loadDomainCashBreakdown", async () => {
  const todayIso = new Date().toISOString().slice(0, 10);
  const month = todayIso.slice(0, 7);
  const window = monthWindow(month, todayIso);
  await loadDomainCashBreakdown(client(), window);
});

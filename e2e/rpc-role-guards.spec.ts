import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { E2E_USERS, type E2ERole } from "./fixtures";

// The role guard inside SECURITY DEFINER functions
// (supabase/migrations/20261004170000_guard_definer_functions.sql). These are
// called the way an attacker would — straight through Supabase's REST API, no
// app route in between — so this only passes if the guard itself holds:
// anonymous callers are refused everywhere, workers are refused the admin/office
// functions, and workers still get through on the ones they need.

function client(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function signedIn(role: E2ERole): Promise<SupabaseClient> {
  const supabase = client();
  const { error } = await supabase.auth.signInWithPassword(E2E_USERS[role]);
  if (error) throw error;
  return supabase;
}

// An order id that doesn't exist: release_order_inventory then deletes nothing,
// so nothing here changes test data.
const NO_SUCH_ORDER = "00000000-0000-0000-0000-00000000dead";

test.describe("database function role guards", () => {
  test("an anonymous caller is refused", async () => {
    const anon = client();
    const release = await anon.rpc("release_order_inventory", { p_order_id: NO_SUCH_ORDER });
    expect(release.error).not.toBeNull();
    const rollup = await anon.rpc("tag_rollup");
    expect(rollup.error).not.toBeNull();
  });

  test("a worker is refused the admin/office-only functions", async () => {
    const worker = await signedIn("worker");
    const release = await worker.rpc("release_order_inventory", { p_order_id: NO_SUCH_ORDER });
    expect(release.error?.message).toBe("No access");
    const metrics = await worker.rpc("get_alert_rule_metrics", { days: 7 });
    expect(metrics.error?.message).toBe("No access");
  });

  test("a worker still gets through on the functions workers use", async () => {
    const worker = await signedIn("worker");
    const rollup = await worker.rpc("tag_rollup");
    expect(rollup.error).toBeNull();
    // update_sales_order / create_sales_order are covered end to end by
    // worker-deliveries.spec.ts (confirm delivery with cash, partial and check
    // payments) and the order specs — they'd fail if the guard refused a worker.
  });

  test("an admin gets through on the admin/office-only functions", async () => {
    const admin = await signedIn("admin");
    const release = await admin.rpc("release_order_inventory", { p_order_id: NO_SUCH_ORDER });
    expect(release.error).toBeNull();
    expect(release.data).toBe(0);
    const metrics = await admin.rpc("get_alert_rule_metrics", { days: 7 });
    expect(metrics.error).toBeNull();
  });
});

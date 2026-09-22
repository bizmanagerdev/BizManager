import fs from "node:fs";
import path from "node:path";
import { test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { getCollectionsSummary } from "@/lib/collections";
import { getInboxView } from "@/lib/reminders/worklist";
import { loadDomainCashBreakdown } from "@/lib/financial";
import { monthWindow } from "@/lib/dashboard/domain-chart";
import {
  getAdminUserId,
  createTestCustomer,
  deleteTestCustomer,
  createTestOrder,
  deleteTestOrder,
  createTestOrderItem,
  createTestPayment,
  deleteTestPayment,
} from "./db";

// TEMPORARY DIAGNOSTIC, round 3 — rounds 1/2 (service-role, then a signed-in
// RLS-scoped client) both surfaced nothing via Playwright's own "github"
// reporter: the current CI run's large unrelated worker-* failure cluster
// exhausts GitHub Actions' own ~10-annotation-per-run cap before this test's
// own message gets a slot. Writing straight to a file instead, printed by a
// dedicated ci.yml step (bypassing the reporter's cap entirely) — the same
// technique already proven earlier this session for the documents-upload
// investigation. Delete this file AND the matching ci.yml step once the
// cause is found.
const DIAG_FILE = path.join(__dirname, "DIAG_OUTPUT.txt");
function diagLog(line: string) {
  fs.appendFileSync(DIAG_FILE, `${line}\n`);
}

function anonClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function signedInAdminClient() {
  const supabase = anonClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: "e2e-admin@bizh.test",
    password: "e2e-test-password-123",
  });
  if (error) throw new Error(`sign-in failed: ${error.message}`);
  return supabase;
}

test("diag: getCollectionsSummary as signed-in admin", async () => {
  const customer = await createTestCustomer({ name: `E2E diag debtor ${Date.now()}` });
  const order = await createTestOrder(customer.id);
  await createTestOrderItem(order.id, { unitPrice: 350, quantityOrdered: 1 });
  try {
    const supabase = await signedInAdminClient();
    const todayIso = new Date().toISOString().slice(0, 10);
    const summary = await getCollectionsSummary(supabase, todayIso);
    diagLog(`getCollectionsSummary OK: ${JSON.stringify(summary)}`);
  } catch (err: unknown) {
    diagLog(`getCollectionsSummary THREW: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  } finally {
    await deleteTestOrder(order.id);
    await deleteTestCustomer(customer.id);
  }
});

test("diag: getInboxView as signed-in admin", async () => {
  const todayIso = new Date().toISOString().slice(0, 10);
  const payment = await createTestPayment({ dueDate: todayIso, amount: 777 });
  try {
    const adminId = await getAdminUserId();
    const supabase = await signedInAdminClient();
    const inbox = await getInboxView(supabase, { userId: adminId, role: "admin" });
    diagLog(`getInboxView OK: ${JSON.stringify(inbox)}`);
  } catch (err: unknown) {
    diagLog(`getInboxView THREW: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  } finally {
    await deleteTestPayment(payment.id);
  }
});

test("diag: loadDomainCashBreakdown as signed-in admin", async () => {
  try {
    const supabase = await signedInAdminClient();
    const todayIso = new Date().toISOString().slice(0, 10);
    const month = todayIso.slice(0, 7);
    const window = monthWindow(month, todayIso);
    const bars = await loadDomainCashBreakdown(supabase, window);
    diagLog(`loadDomainCashBreakdown OK: ${JSON.stringify(bars)}`);
  } catch (err: unknown) {
    diagLog(`loadDomainCashBreakdown THREW: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  }
});

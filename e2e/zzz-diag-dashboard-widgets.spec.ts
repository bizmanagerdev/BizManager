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

// TEMPORARY DIAGNOSTIC, round 2 — round 1 called these functions with a
// SERVICE-ROLE client and every call succeeded with no thrown error. But RLS
// doesn't throw on a restricted SELECT, it just silently returns fewer/zero
// rows — so a service-role call proves nothing about what the REAL app (an
// RLS-scoped client, authenticated as the admin user via cookies) actually
// sees. This round signs in as the real e2e-admin user first, seeds the
// exact same data the failing widget tests seed, and throws the actual
// result so it's visible in the report either way.
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
    throw new Error(`RESULT: ${JSON.stringify(summary)}`);
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
    throw new Error(`RESULT: ${JSON.stringify(inbox)}`);
  } finally {
    await deleteTestPayment(payment.id);
  }
});

test("diag: loadDomainCashBreakdown as signed-in admin", async () => {
  const supabase = await signedInAdminClient();
  const todayIso = new Date().toISOString().slice(0, 10);
  const month = todayIso.slice(0, 7);
  const window = monthWindow(month, todayIso);
  const bars = await loadDomainCashBreakdown(supabase, window);
  throw new Error(`RESULT: ${JSON.stringify(bars)}`);
});

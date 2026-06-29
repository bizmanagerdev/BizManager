import { describe, it, expect } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// REAL RLS enforcement test. Unlike rls-policies.test.ts (static text guard),
// this signs in as actual users of each role against a real Supabase project and
// asserts the access matrix the policies are SUPPOSED to enforce.
//
// It is env-gated and SKIPS unless the following are set (so CI stays green
// until a staging project / local `supabase start` exists). NEVER point these at
// production — the worker-write assertions intentionally attempt denied writes.
//
//   RLS_TEST_URL            e.g. http://127.0.0.1:54321  (local) or a STAGING url
//   RLS_TEST_ANON_KEY       the anon/publishable key for that project
//   RLS_TEST_ADMIN_EMAIL    + RLS_TEST_ADMIN_PASSWORD    (an active admin user)
//   RLS_TEST_WORKER_EMAIL   + RLS_TEST_WORKER_PASSWORD   (an active worker user)
//
// Once the migration baseline includes the RLS policies, the fastest setup is:
//   supabase start  →  seed one admin + one worker user  →  set the env vars.

const env = process.env;
const READY = Boolean(
  env.RLS_TEST_URL &&
    env.RLS_TEST_ANON_KEY &&
    env.RLS_TEST_ADMIN_EMAIL &&
    env.RLS_TEST_ADMIN_PASSWORD &&
    env.RLS_TEST_WORKER_EMAIL &&
    env.RLS_TEST_WORKER_PASSWORD
);

function anonClient(): SupabaseClient {
  return createClient(env.RLS_TEST_URL!, env.RLS_TEST_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function signedInClient(email: string, password: string): Promise<SupabaseClient> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return client;
}

describe.skipIf(!READY)("RLS live enforcement (env-gated)", () => {
  it("anonymous (unauthenticated) cannot read payments", async () => {
    const anon = anonClient();
    const { data, error } = await anon.from("payments").select("id").limit(1);
    // RLS denies → either an error or an empty set; never real rows.
    expect(error !== null || (Array.isArray(data) && data.length === 0)).toBe(true);
  });

  it("an active admin CAN read payments", async () => {
    const admin = await signedInClient(env.RLS_TEST_ADMIN_EMAIL!, env.RLS_TEST_ADMIN_PASSWORD!);
    const { error } = await admin.from("payments").select("id").limit(1);
    expect(error).toBeNull();
  });

  it("a worker CANNOT insert a payment", async () => {
    const worker = await signedInClient(env.RLS_TEST_WORKER_EMAIL!, env.RLS_TEST_WORKER_PASSWORD!);
    const { error } = await worker.from("payments").insert({
      amount_total: 1,
      payment_date: "2024-01-01",
      payment_method: "cash",
      business_domain: "general_business",
    });
    // The write must be rejected by RLS — nothing is persisted.
    expect(error).not.toBeNull();
  });
});

// A single always-present test so the file reports a result (and reminds us how
// to enable the real suite) even when the env-gated block is skipped.
describe("RLS live enforcement — availability", () => {
  it(READY ? "credentials present: live RLS suite is running" : "skipped: set RLS_TEST_* env vars to run the live RLS matrix", () => {
    expect(typeof READY).toBe("boolean");
  });
});

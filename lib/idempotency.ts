import { NextResponse } from "next/server";
import type { createSupabaseRouteClient } from "@/lib/supabase/route";

type RouteClient = Awaited<ReturnType<typeof createSupabaseRouteClient>>;

// fetch Headers.get() is case-insensitive, so this matches the client's
// "Idempotency-Key" header regardless of casing.
export const IDEMPOTENCY_HEADER = "idempotency-key";

/**
 * A claim still "processing" after this long is dead: the request that made it
 * was cut off before it could finish (Vercel stops any request well before
 * this), and the next resend takes it over and does the work. A claim that
 * never ran out told every resend "still working" for good (audit 2026-10-27).
 */
export const PROCESSING_EXPIRES_MS = 15 * 60_000;

/** The resend of a save whose first send is still being worked on is asked to try again after this. */
export const PENDING_RETRY_AFTER_S = 10;

/**
 * "Still working on it — send it again shortly." A 503, which every client —
 * phones on an older version too — already sends again later; it used to be a
 * 202 ("accepted"), and the phone threw the save away, so one whose first send
 * then failed was lost. `pending` tells the send queues to keep it quietly
 * (isStillWorking, lib/still-working.ts).
 */
function stillWorking(): NextResponse {
  return NextResponse.json(
    { error: "השמירה עדיין מתבצעת. היא תישלח שוב בעוד כמה שניות.", pending: true },
    { status: 503, headers: { "Retry-After": String(PENDING_RETRY_AFTER_S) } }
  );
}

/**
 * Make a write idempotent so a queued offline request is safe to replay.
 *
 * The client sends an Idempotency-Key with at-risk writes. The first time we see
 * a key we run `handler`, then cache its response. Any later request with the
 * same key returns the cached response WITHOUT re-running the work — so a replay
 * (e.g. the response was lost on a flaky network) can never create a duplicate
 * record or fire a side effect twice.
 *
 * A key is the person's own (the table's key is person + key): another
 * person's save with the same key is a different save.
 *
 * Requests without a key behave exactly as before (handler runs directly), so
 * this is safe to wrap around any route.
 */
export async function withIdempotency(
  req: Request,
  supabase: RouteClient,
  userId: string,
  endpoint: string,
  handler: () => Promise<NextResponse>
): Promise<NextResponse> {
  const key = req.headers.get(IDEMPOTENCY_HEADER)?.trim();
  if (!key) return handler();

  // Claim the key. The primary-key unique violation is how we detect a replay.
  const { error: claimError } = await supabase
    .from("idempotency_keys")
    .insert({ key, user_id: userId, endpoint, status: "processing" });

  if (claimError) {
    // 23505 = unique_violation ⇒ this key was already claimed (a replay).
    // Any other error: fail open and run the handler — we never block a
    // legitimate write just because the dedup bookkeeping hiccuped.
    if ((claimError as { code?: string }).code !== "23505") {
      return handler();
    }

    const { data: existing } = await supabase
      .from("idempotency_keys")
      .select("status,response_status,response_body,created_at")
      .eq("user_id", userId)
      .eq("key", key)
      .maybeSingle();

    if (existing?.status === "done") {
      return NextResponse.json(existing.response_body ?? { deduped: true }, {
        status: existing.response_status ?? 200,
      });
    }
    // Not found: its first send has just failed and let go of it — the resend
    // makes a fresh claim. Still 'processing' — the first send is in flight:
    // the resend waits for it, unless it's dead (PROCESSING_EXPIRES_MS).
    const claimedAt = Date.parse(String(existing?.created_at ?? ""));
    if (existing?.status !== "processing" || !(claimedAt < Date.now() - PROCESSING_EXPIRES_MS)) {
      return stillWorking();
    }
    // Take the dead claim over. Only one resend can: the claim gets a new
    // time, so a second one racing it no longer finds it expired.
    const { data: taken } = await supabase
      .from("idempotency_keys")
      .update({ created_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("key", key)
      .eq("status", "processing")
      .lt("created_at", new Date(Date.now() - PROCESSING_EXPIRES_MS).toISOString())
      .select("key");
    if (!taken?.length) return stillWorking();
  }

  // Fresh key (or a dead claim taken over) → run the real work.
  let res: NextResponse;
  try {
    res = await handler();
  } catch (err) {
    // Release the claim so a real retry can run the work next time.
    await supabase.from("idempotency_keys").delete().eq("user_id", userId).eq("key", key);
    throw err;
  }

  if (res.status >= 200 && res.status < 300) {
    // Cache the success so a replay returns the identical response.
    let body: unknown = null;
    try {
      body = await res.clone().json();
    } catch {
      body = null;
    }
    await supabase
      .from("idempotency_keys")
      .update({ status: "done", response_status: res.status, response_body: body })
      .eq("user_id", userId)
      .eq("key", key);
  } else {
    // Validation/permission error etc. — release the claim so the user can fix
    // the input and submit again under a fresh key.
    await supabase.from("idempotency_keys").delete().eq("user_id", userId).eq("key", key);
  }

  return res;
}

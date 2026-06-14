import { NextResponse } from "next/server";
import type { createSupabaseRouteClient } from "@/lib/supabase/route";

type RouteClient = Awaited<ReturnType<typeof createSupabaseRouteClient>>;

// fetch Headers.get() is case-insensitive, so this matches the client's
// "Idempotency-Key" header regardless of casing.
export const IDEMPOTENCY_HEADER = "idempotency-key";

/**
 * Make a write idempotent so a queued offline request is safe to replay.
 *
 * The client sends an Idempotency-Key with at-risk writes. The first time we see
 * a key we run `handler`, then cache its response. Any later request with the
 * same key returns the cached response WITHOUT re-running the work — so a replay
 * (e.g. the response was lost on a flaky network) can never create a duplicate
 * record or fire a side effect twice.
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
      .select("status,response_status,response_body")
      .eq("key", key)
      .maybeSingle();

    if (existing?.status === "done") {
      return NextResponse.json(existing.response_body ?? { deduped: true }, {
        status: existing.response_status ?? 200,
      });
    }
    // Still 'processing' — the original request is concurrently in flight. Treat
    // the replay as accepted so the offline queue stops retrying; the original
    // will complete the work and cache the real response.
    return NextResponse.json({ deduped: true, pending: true }, { status: 202 });
  }

  // Fresh key → run the real work.
  let res: NextResponse;
  try {
    res = await handler();
  } catch (err) {
    // Release the claim so a real retry can run the work next time.
    await supabase.from("idempotency_keys").delete().eq("key", key);
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
      .eq("key", key);
  } else {
    // Validation/permission error etc. — release the claim so the user can fix
    // the input and submit again under a fresh key.
    await supabase.from("idempotency_keys").delete().eq("key", key);
  }

  return res;
}

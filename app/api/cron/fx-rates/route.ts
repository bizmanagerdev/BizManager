import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { syncFxRates } from "@/lib/fx/rates";
import { withSentry } from "@/lib/sentry-lazy";

// Twice a day: the Bank of Israel's US$ and C$ rates into public.fx_rates.
// The bank publishes at about 15:30 Israel time on weekdays; 14:00 UTC is
// after that all year (16:00/17:00 Israel), and 19:00 UTC tries again if the
// first run failed or the bank was late. The first run into an empty table
// loads the history back to 2015. Safe to repeat.
//
// A missing rate doesn't stop anything — a day without one takes the last
// rate before it — so a job that has quietly stopped would only show as old
// rates. Sentry hears about it when the newest rate is over a week old.
export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" }, { status: 500 });

  try {
    const result = await syncFxRates(supabase);
    if (result.stale.length > 0) {
      withSentry((Sentry) =>
        Sentry.captureMessage(`Exchange rates are old: ${result.stale.join(", ")}`, {
          level: "warning",
          tags: { area: "fx-rates" },
          extra: { latest: result.latest },
        })
      );
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    withSentry((Sentry) =>
      Sentry.captureException(error instanceof Error ? error : new Error(message), { tags: { area: "fx-rates" } })
    );
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

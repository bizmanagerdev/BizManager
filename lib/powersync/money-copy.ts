import type { SupabaseClient } from "@supabase/supabase-js";

// The dashboard's money cards need tables a copy synced before sync rules
// v1.8 doesn't have (loans, card statements, settlements…) — and an empty
// table on a copy that simply hasn't received it yet would read as "no loans",
// a wrong figure with nothing to say so. The rules mark the copies that have
// them: business_settings.money_tables = 1, which arrives in the same complete
// download as the tables themselves. Only such a copy works the money cards
// out (lib/powersync/dashboard-local.ts), and LocalDataHost tells the server
// with this cookie, so the board draws them from the device only where the
// copy can (moneyCardsOnDevice in lib/powersync/device-check.ts) — elsewhere
// the server's version, as before. Client-safe.

export const MONEY_COPY_COOKIE = "bizh-money-copy";

/** Without news for this long it goes (the server version until the device says again). */
const MAX_AGE_S = 7 * 24 * 60 * 60;

/** Does this copy carry the money tables (sync rules v1.8 or later)? */
export async function copyHasMoneyTables(local: SupabaseClient): Promise<boolean> {
  const { data, error } = await local.from("business_settings").select("money_tables").limit(1);
  if (error || !Array.isArray(data) || data.length === 0) return false;
  return (data[0] as { money_tables?: unknown }).money_tables === 1;
}

function moneyCopyCookieSet(): boolean {
  return document.cookie.split(";").some((part) => part.trim().startsWith(`${MONEY_COPY_COOKIE}=`));
}

export function setMoneyCopyReady(ready: boolean): void {
  if (typeof document === "undefined") return;
  // Ready: (re)set, so it lasts as long as the copy keeps saying so.
  if (!ready && !moneyCopyCookieSet()) return;
  document.cookie = ready
    ? `${MONEY_COPY_COOKIE}=1; path=/; max-age=${MAX_AGE_S}; samesite=lax`
    : `${MONEY_COPY_COOKIE}=; path=/; max-age=0; samesite=lax`;
}

import type { SupabaseClient } from "@supabase/supabase-js";
import DashboardLocalShadow from "@/components/powersync/DashboardLocalShadow";
import { deviceCheckCookie } from "@/lib/powersync/device-check";
import { israelDateKey } from "@/lib/timezone";
import type { Locale } from "@/lib/i18n/types";
import { loadRentRoll } from "@/lib/properties";

/**
 * The rent roll as the server reads it, for the device to compare with its
 * own (once a day per device — lib/powersync/device-check.ts). Rendered in a
 * Suspense boundary after the page, so it never holds the page up.
 */
export default async function RentRollServerCheck({
  supabase,
  userId,
  role,
  locale,
}: {
  supabase: SupabaseClient;
  userId: string;
  role: string;
  locale: Locale;
}) {
  const renderedAt = new Date().toISOString();
  const data = await loadRentRoll(supabase).catch(() => null);
  if (!data) return null;
  return (
    <DashboardLocalShadow
      doneCookie={deviceCheckCookie("rentRoll")}
      snapshot={{
        renderedAt,
        userId,
        role,
        locale,
        todayIso: israelDateKey(),
        cards: { rentRoll: { data } },
      }}
    />
  );
}

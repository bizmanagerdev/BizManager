import type { SupabaseClient } from "@supabase/supabase-js";
import DashboardLocalShadow from "@/components/powersync/DashboardLocalShadow";
import { deviceCheckCookie } from "@/lib/powersync/device-check";
import { israelDateKey } from "@/lib/timezone";
import type { Locale } from "@/lib/i18n/types";
import { loadBankPage } from "./loadBankPage";

/**
 * The accounts page as the server reads it, for the device to compare with
 * its own (once a day per device — lib/powersync/device-check.ts). Rendered in
 * a Suspense boundary after the page, so it never holds the page up.
 */
export default async function BankServerCheck({
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
  const data = await loadBankPage(supabase);
  // A read that failed on the server: nothing fair to compare with.
  if (data.dataIncomplete) return null;
  return (
    <DashboardLocalShadow
      doneCookie={deviceCheckCookie("bank")}
      snapshot={{ renderedAt, userId, role, locale, todayIso: israelDateKey(), cards: { bankPage: data } }}
    />
  );
}

import type { SupabaseClient } from "@supabase/supabase-js";
import DashboardLocalShadow from "@/components/powersync/DashboardLocalShadow";
import { deviceCheckCookie } from "@/lib/powersync/device-check";
import { loadPaymentsCalendarView } from "@/lib/financial/paymentsCalendarPage";
import { israelDateKey } from "@/lib/timezone";
import type { Locale } from "@/lib/i18n/types";

/**
 * The payments calendar as the server reads it, for the device to compare with
 * its own (once a day per device — lib/powersync/device-check.ts): the same
 * code. Rendered in a Suspense boundary after the page, so it never holds the
 * page up.
 */
export default async function PaymentsCalendarServerCheck({
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
  const view = await loadPaymentsCalendarView(supabase);
  // A scan that failed here is no comparison.
  if (view.error) return null;
  return (
    <DashboardLocalShadow
      doneCookie={deviceCheckCookie("paymentsCalendar")}
      snapshot={{ renderedAt, userId, role, locale, todayIso: israelDateKey(), cards: { paymentsCalendar: view } }}
    />
  );
}

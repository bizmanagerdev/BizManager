import type { SupabaseClient } from "@supabase/supabase-js";
import DashboardLocalShadow from "@/components/powersync/DashboardLocalShadow";
import { deviceCheckCookie } from "@/lib/powersync/device-check";
import { getCalendarFeeds } from "@/lib/projectSchedule";
import { israelDateKey } from "@/lib/timezone";
import type { Locale } from "@/lib/i18n/types";

/**
 * The calendar as the server reads it, for the device to compare with its own
 * (once a day per device — lib/powersync/device-check.ts). Rendered in a
 * Suspense boundary after the page, so it never holds the page up.
 */
export default async function CalendarServerCheck({
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
  const feeds = await getCalendarFeeds(supabase, { userId, canSeeAll: role === "admin" || role === "office" }).catch(
    () => null
  );
  if (!feeds) return null;
  return (
    <DashboardLocalShadow
      doneCookie={deviceCheckCookie("calendar")}
      snapshot={{ renderedAt, userId, role, locale, todayIso: israelDateKey(), cards: { calendar: feeds } }}
    />
  );
}

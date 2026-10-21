import type { SupabaseClient } from "@supabase/supabase-js";
import DashboardLocalShadow from "@/components/powersync/DashboardLocalShadow";
import { deviceCheckCookie } from "@/lib/powersync/device-check";
import { israelDateKey } from "@/lib/timezone";
import type { Locale } from "@/lib/i18n/types";
import { loadPropertyPageCore } from "@/lib/properties";

/**
 * A property's page as the server reads it — the part the device also works
 * out (loadPropertyPageCore) — for the device to compare with its own, once a
 * day per device (lib/powersync/device-check.ts). Rendered in a Suspense
 * boundary after the page, so it never holds the page up.
 */
export default async function PropertyPageServerCheck({
  supabase,
  id,
  userId,
  role,
  locale,
}: {
  supabase: SupabaseClient;
  id: string;
  userId: string;
  role: string;
  locale: Locale;
}) {
  const renderedAt = new Date().toISOString();
  const core = await loadPropertyPageCore(supabase, id).catch(() => null);
  if (!core) return null;
  return (
    <DashboardLocalShadow
      doneCookie={deviceCheckCookie("propertyPage")}
      snapshot={{
        renderedAt,
        userId,
        role,
        locale,
        todayIso: israelDateKey(),
        cards: { propertyPage: { filters: { id }, core } },
      }}
    />
  );
}

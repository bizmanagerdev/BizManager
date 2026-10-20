import type { SupabaseClient } from "@supabase/supabase-js";
import DashboardLocalShadow from "@/components/powersync/DashboardLocalShadow";
import { deviceCheckCookie } from "@/lib/powersync/device-check";
import { israelDateKey } from "@/lib/timezone";
import type { Locale } from "@/lib/i18n/types";
import { startCustomerCoreReads } from "./customerPageCore";

/**
 * A customer's page as the server reads it — the part the device also works
 * out (customerPageCore.ts) — for the device to compare with its own, once a
 * day per device (lib/powersync/device-check.ts). Rendered in a Suspense
 * boundary after the page, so it never holds the page up.
 */
export default async function CustomerPageServerCheck({
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
  const reads = startCustomerCoreReads(supabase, id, { role: Promise.resolve(role), viewerId: Promise.resolve(userId) });
  const [core, payments] = await Promise.all([reads.core, reads.payments]);
  if (!core || payments.error || Object.values(core.errors).some(Boolean)) return null;
  return (
    <DashboardLocalShadow
      doneCookie={deviceCheckCookie("customerPage")}
      snapshot={{
        renderedAt,
        userId,
        role,
        locale,
        todayIso: israelDateKey(),
        cards: { customerPage: { filters: { id }, core, payments } },
      }}
    />
  );
}

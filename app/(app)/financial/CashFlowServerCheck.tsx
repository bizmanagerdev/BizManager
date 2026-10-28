import type { SupabaseClient } from "@supabase/supabase-js";
import DashboardLocalShadow from "@/components/powersync/DashboardLocalShadow";
import { deviceCheckCookie } from "@/lib/powersync/device-check";
import { loadCashFlowFlowView, type CashFlowViewFilters } from "@/lib/financial/cashFlowPage";
import { israelDateKey } from "@/lib/timezone";
import type { Locale } from "@/lib/i18n/types";

/**
 * The cash-flow page as the server reads it, for the device to compare with
 * its own (once a day per device — lib/powersync/device-check.ts): the same
 * code, the same filters. Rendered in a Suspense boundary after the page, so
 * it never holds the page up.
 */
export default async function CashFlowServerCheck({
  supabase,
  filters,
  userId,
  role,
  locale,
}: {
  supabase: SupabaseClient;
  filters: CashFlowViewFilters;
  userId: string;
  role: string;
  locale: Locale;
}) {
  const renderedAt = new Date().toISOString();
  const view = await loadCashFlowFlowView(supabase, filters);
  return (
    <DashboardLocalShadow
      doneCookie={deviceCheckCookie("cashFlow")}
      snapshot={{ renderedAt, userId, role, locale, todayIso: israelDateKey(), cards: { cashFlow: { filters, ...view } } }}
    />
  );
}

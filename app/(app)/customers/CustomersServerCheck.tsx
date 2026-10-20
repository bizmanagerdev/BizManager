import type { SupabaseClient } from "@supabase/supabase-js";
import DashboardLocalShadow from "@/components/powersync/DashboardLocalShadow";
import { deviceCheckCookie } from "@/lib/powersync/device-check";
import { israelDateKey } from "@/lib/timezone";
import type { Locale } from "@/lib/i18n/types";
import { loadCustomersPage, type CustomersFilters } from "./loadCustomers";

/**
 * The customers list as the server reads it, for the device to compare with
 * its own (once a day per device — lib/powersync/device-check.ts). Rendered in
 * a Suspense boundary after the page, so it never holds the page up.
 */
export default async function CustomersServerCheck({
  supabase,
  filters,
  userId,
  role,
  locale,
}: {
  supabase: SupabaseClient;
  filters: CustomersFilters;
  userId: string;
  role: string;
  locale: Locale;
}) {
  const renderedAt = new Date().toISOString();
  const list = await loadCustomersPage(supabase, { page: 1, filters });
  if (list.error) return null;
  return (
    <DashboardLocalShadow
      doneCookie={deviceCheckCookie("customers")}
      snapshot={{
        renderedAt,
        userId,
        role,
        locale,
        todayIso: israelDateKey(),
        cards: {
          customersList: { filters, rows: list.rows, hasMore: list.hasMore, totalCount: list.totalCount },
        },
      }}
    />
  );
}

import type { SupabaseClient } from "@supabase/supabase-js";
import DashboardLocalShadow from "@/components/powersync/DashboardLocalShadow";
import { deviceCheckCookie } from "@/lib/powersync/device-check";
import { loadProjectPageCore } from "@/lib/projects/project-page";
import { israelDateKey } from "@/lib/timezone";
import type { Locale } from "@/lib/i18n/types";

/**
 * The project as the server reads it for its page, for the device to compare
 * with its own (once a day per device — lib/powersync/device-check.ts).
 * Rendered in a Suspense boundary after the page, so it never holds the page up.
 */
export default async function ProjectServerCheck({
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
  const core = await loadProjectPageCore(supabase, id);
  // Once read: the device compares only after it has synced past this.
  const renderedAt = new Date().toISOString();
  if (!core.dashboardRow || Object.values(core.errors).some(Boolean)) return null;
  return (
    <DashboardLocalShadow
      doneCookie={deviceCheckCookie("projectPage")}
      snapshot={{ renderedAt, userId, role, locale, todayIso: israelDateKey(), cards: { projectPage: core } }}
    />
  );
}

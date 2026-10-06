import type { SupabaseClient } from "@supabase/supabase-js";
import DashboardLocalShadow from "@/components/powersync/DashboardLocalShadow";
import { deviceCheckCookie } from "@/lib/powersync/device-check";
import { israelDateKey } from "@/lib/timezone";
import type { Locale } from "@/lib/i18n/types";
import { loadTaskPickerOptions, loadTasksBoard, type TasksFilters } from "./loadTasks";

/**
 * The tasks board as the server reads it, for the device to compare with its
 * own (once a day per device — lib/powersync/device-check.ts). Rendered in a
 * Suspense boundary after the page, so it never holds the page up.
 */
export default async function TasksServerCheck({
  supabase,
  filters,
  userId,
  role,
  locale,
  canSeeAll,
}: {
  supabase: SupabaseClient;
  filters: TasksFilters;
  userId: string;
  role: string;
  locale: Locale;
  canSeeAll: boolean;
}) {
  const [board, options] = await Promise.all([
    loadTasksBoard(supabase, { filters, userId, canSeeAll, locale }),
    loadTaskPickerOptions(supabase),
  ]);
  if (board.error) return null;
  return (
    <DashboardLocalShadow
      doneCookie={deviceCheckCookie("tasks")}
      snapshot={{
        renderedAt: new Date(board.loadedAt).toISOString(),
        userId,
        role,
        locale,
        todayIso: israelDateKey(),
        cards: { tasksBoard: { filters, items: board.items, options } },
      }}
    />
  );
}

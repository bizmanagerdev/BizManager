import { createSupabaseServerClient } from "@/lib/supabase/server";
import MyShiftCard from "@/components/attendance/MyShiftCard";
import { loadMyShiftState } from "@/lib/attendance/my-shift";
import type { Locale } from "@/lib/i18n/types";

/**
 * The clock, on the worker's dashboard. Its own server component so the one
 * query it needs streams inside a Suspense boundary instead of delaying the
 * greeting and the quick-action buttons.
 */
export default async function WorkerShiftPanel({ userId, locale }: { userId: string; locale: Locale }) {
  const supabase = await createSupabaseServerClient();
  const state = await loadMyShiftState(supabase, userId, { limit: 10 });
  return <MyShiftCard openShift={state.open} pendingCount={state.pending.length} locale={locale} />;
}

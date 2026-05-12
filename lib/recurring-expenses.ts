import type { SupabaseClient } from "@supabase/supabase-js";

type EnsureRecurringExpensesResult = {
  ok: boolean;
  createdCount: number;
  skippedMissingSchema: boolean;
  error?: string;
};

type EnsureRecurringExpensesCacheStore = Map<string, Promise<EnsureRecurringExpensesResult>>;

declare global {
  var __bizmanagerRecurringExpensesEnsureCache: EnsureRecurringExpensesCacheStore | undefined;
}

function looksLikeMissingSchema(message: string) {
  const value = message.toLowerCase();
  return value.includes("does not exist") || value.includes("could not find") || value.includes("schema cache");
}

function getEnsureRecurringExpensesCache() {
  if (!globalThis.__bizmanagerRecurringExpensesEnsureCache) {
    globalThis.__bizmanagerRecurringExpensesEnsureCache = new Map<
      string,
      Promise<EnsureRecurringExpensesResult>
    >();
  }
  return globalThis.__bizmanagerRecurringExpensesEnsureCache;
}

function ensureCacheKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

async function runEnsureRecurringExpensesForDate(
  supabase: SupabaseClient,
  options?: { today?: Date }
): Promise<EnsureRecurringExpensesResult> {
  const today = options?.today ?? new Date();
  const todayIso = today.toISOString().slice(0, 10);

  const { data, error } = await supabase.rpc("generate_recurring_expenses_for_date", {
    p_today: todayIso,
  });

  if (error) {
    if (looksLikeMissingSchema(error.message)) {
      return { ok: true, createdCount: 0, skippedMissingSchema: true };
    }
    return { ok: false, createdCount: 0, skippedMissingSchema: false, error: error.message };
  }

  const createdCount =
    typeof data === "number"
      ? data
      : typeof data === "string"
        ? Number(data) || 0
        : 0;

  return { ok: true, createdCount, skippedMissingSchema: false };
}

export function ensureRecurringExpensesForDate(
  supabase: SupabaseClient,
  options?: { today?: Date }
) {
  const today = options?.today ?? new Date();
  const key = ensureCacheKey(today);
  const cache = getEnsureRecurringExpensesCache();
  const existing = cache.get(key);
  if (existing) return existing;

  const promise = runEnsureRecurringExpensesForDate(supabase, { ...options, today })
    .then((result) => {
      if (!result.ok) cache.delete(key);
      return result;
    })
    .catch((error) => {
      cache.delete(key);
      throw error;
    });

  cache.set(key, promise);
  return promise;
}

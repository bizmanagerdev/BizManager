"use client";

import * as React from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { loadRateTable, type RateTable } from "@/lib/fx/day-rates";
import { israelDateKey } from "@/lib/timezone";

// The Bank of Israel's rates over the days a page's movements fall on — read
// once per stretch for the session, since a past day's rate never moves.
// Null until they're in (or with no connection): the page shows ₪ meanwhile.

const cache = new Map<string, Promise<RateTable | null>>();

function readRates(from: string, to: string): Promise<RateTable | null> {
  const key = `${from}|${to}`;
  const known = cache.get(key);
  if (known) return known;
  const read = loadRateTable(createSupabaseBrowserClient(), from, to).catch(() => {
    cache.delete(key); // not kept: the next try may reach it
    return null;
  });
  cache.set(key, read);
  return read;
}

/** The rates from the earliest of `days` to today (or the latest of them, if later). */
export function useRateTable(days: readonly (string | null | undefined)[], enabled = true): RateTable | null {
  let from: string | null = null;
  let to = israelDateKey();
  for (const day of days) {
    if (!day) continue;
    if (!from || day < from) from = day;
    if (day > to) to = day;
  }
  const key = enabled && from ? `${from}|${to}` : null;
  const [found, setFound] = React.useState<{ key: string; table: RateTable | null } | null>(null);
  React.useEffect(() => {
    if (!key) return;
    const [start, end] = key.split("|");
    let active = true;
    void readRates(start, end).then((table) => {
      if (active) setFound({ key, table });
    });
    return () => {
      active = false;
    };
  }, [key]);
  return key && found?.key === key ? found.table : null;
}

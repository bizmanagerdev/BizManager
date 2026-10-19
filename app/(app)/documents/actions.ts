"use server";

import { requireProfile } from "@/lib/auth/requireProfile";
import { findRecords } from "@/lib/global-search";
import type { LedgerCandidate } from "@/lib/documents/moneyLink";

/**
 * "שיוך להוצאה או לתשלום": the expenses and payments a typed search finds —
 * by the global search (owner, 2026-10-19: only the newest 40 of each could
 * ever be found). Any of them, by amount, date, hour, check or reference
 * number, or a word in it; best match first, with why each came up.
 */
export async function findLedgerDocumentMatches(query: string): Promise<{ candidates: LedgerCandidate[]; terms: string[] }> {
  const { supabase, profile } = await requireProfile();
  const { records, terms } = await findRecords(supabase, {
    query,
    kinds: ["expense", "payment"],
    viewerRole: profile.role,
    viewerId: profile.id,
    limit: 25,
  });
  return {
    candidates: records.map((record) => ({
      id: record.id,
      entityType: record.kind === "expense" ? "expense" : "payment",
      label: record.subtitle ? `${record.title} · ${record.subtitle}` : record.title,
      date: record.date,
      amount: record.amount,
      reasons: record.reasons,
    })),
    terms,
  };
}

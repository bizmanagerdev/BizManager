"use server";

import { requireProfile } from "@/lib/auth/requireProfile";
import { formatShortDate } from "@/lib/date";
import type { GlobalSearchReason } from "@/lib/global-search";
import { formatMoney } from "@/lib/money";
import { searchList } from "@/lib/search/listSearch";
import { fetchAllPaged } from "@/lib/supabase/paginate";

type LineRow = {
  statement_id: string;
  description: string | null;
  amount: number | null;
  expense_date: string | null;
  transaction_date: string | null;
  category: string | null;
  card_label: string | null;
  notes: string | null;
};

/**
 * The uploaded statements whose LINES match a search (owner, 2026-10-19:
 * "credit-card statement lines … no search") — "ביאנקו", "1700", "15/10" finds
 * the statement that holds that charge, by the global search's rules. For each
 * statement: how many of its lines matched, and the first one, to show as why.
 */
export async function findStatementsByLines(
  query: string
): Promise<Record<string, { count: number; reason: GlobalSearchReason }>> {
  const { supabase } = await requireProfile();
  if (!query.trim()) return {};
  const lines = await fetchAllPaged<LineRow>((from, to) =>
    supabase
      .from("card_statement_rows")
      .select("statement_id,description,amount,expense_date,transaction_date,category,card_label,notes")
      .order("statement_id")
      .order("id")
      .range(from, to)
  );
  const found = searchList(
    lines,
    (line) => ({
      text: [
        [null, line.description],
        [null, line.category],
        [null, line.card_label],
        [null, line.notes],
      ],
      amounts: [[null, line.amount]],
      dates: [
        [null, line.expense_date],
        [null, line.transaction_date],
      ],
    }),
    query
  );
  const byStatement: Record<string, { count: number; reason: GlobalSearchReason }> = {};
  for (const line of found?.items ?? []) {
    const entry = byStatement[line.statement_id];
    if (entry) {
      entry.count += 1;
      continue;
    }
    const day = line.transaction_date ?? line.expense_date;
    byStatement[line.statement_id] = {
      count: 1,
      reason: {
        kind: "text",
        label: "שורה",
        value: [line.description, line.amount !== null ? formatMoney(line.amount) : null, day ? formatShortDate(day) : null]
          .filter(Boolean)
          .join(" · "),
      },
    };
  }
  return byStatement;
}

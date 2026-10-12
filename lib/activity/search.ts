import type { SupabaseClient } from "@supabase/supabase-js";
import { auditActionValues, buildAuditFeedItems, type AuditCursor, type AuditFeedPage, type AuditLogRow } from "@/lib/audit";
import { toHebrewError } from "@/lib/error-messages";

// The activity page's free search: "כהן", "800" or "צ׳ק" finds every action
// about it. The database does the finding (search_activity); this side turns
// what was typed into what the log stores — a word into its stored value, an
// amount into a number.

export type ActivitySearchTerms = {
  /** The words as typed — names, subjects, notes, file names, check numbers. */
  text: string | null;
  /** Stored values the words stand for ("צ׳ק" → check, "נמסר" → delivered). */
  values: string[];
  /** An exact amount, when what was typed is one ("₪1,500", "800"). */
  amount: number | null;
};

// Hebrew words → the values the log stores for them. Matched on the whole
// query, after the apostrophe variants of צ׳ק are made one.
const WORD_VALUES: Record<string, string[]> = {
  "צק": ["check", "cheque"],
  "שק": ["check", "cheque"],
  "מזומן": ["cash"],
  "אשראי": ["credit_card", "credit", "card"],
  "כרטיס אשראי": ["credit_card", "credit", "card"],
  "העברה": ["bank_transfer", "transfer"],
  "העברה בנקאית": ["bank_transfer", "transfer"],
  "ביט": ["bit"],
  "פייבוקס": ["paybox"],
  "נמסר": ["delivered"],
  "נמסרה": ["delivered"],
  "סופק": ["delivered"],
  "בוצע": ["done", "completed"],
  "בוצעה": ["done", "completed"],
  "הושלם": ["done", "completed"],
  "בוטל": ["cancelled", "canceled"],
  "בוטלה": ["cancelled", "canceled"],
  "טיוטה": ["draft"],
  "ממתין": ["pending"],
  "נפרע": ["cleared"],
  "חזר": ["bounced"],
};

export function parseActivitySearch(raw: string): ActivitySearchTerms {
  const text = raw.trim().replace(/\s+/g, " ");
  if (!text) return { text: null, values: [], amount: null };
  // צ'ק, צ׳ק, צ’ק and "צק" are one word.
  const word = text.replace(/['׳’"״`]/g, "");
  const values = WORD_VALUES[word] ?? [];
  const numeric = text.replace(/[₪,\s]/g, "");
  const amount = /^\d+(\.\d+)?$/.test(numeric) ? Number(numeric) : null;
  return { text, values, amount: amount !== null && Number.isFinite(amount) ? amount : null };
}

export async function searchActivity(
  supabase: SupabaseClient,
  query: string,
  {
    before = null,
    tableName = null,
    action = null,
    changedByValues = null,
    limit = 100,
  }: {
    before?: AuditCursor | null;
    tableName?: string | null;
    action?: string | null;
    changedByValues?: string[] | null;
    limit?: number;
  } = {}
): Promise<AuditFeedPage> {
  const terms = parseActivitySearch(query);
  if (!terms.text) return { items: [], hasMore: false, error: null };

  const { data, error } = await supabase.rpc("search_activity", {
    p_text: terms.text,
    p_values: terms.values,
    p_amount: terms.amount,
    p_table: tableName || null,
    p_actions: action ? auditActionValues(action) : null,
    p_actors: changedByValues && changedByValues.length ? changedByValues : null,
    p_before_at: before?.createdAt ?? null,
    p_before_id: before?.id ?? null,
    p_limit: limit + 1,
  });
  if (error) {
    // The function isn't in the database yet (it goes in with the owner's OK).
    const missing = error.code === "PGRST202" || /search_activity/.test(error.message ?? "");
    return { items: [], hasMore: false, error: missing ? "החיפוש עוד לא הופעל במערכת" : toHebrewError(error.message) };
  }
  const rows = (data ?? []) as AuditLogRow[];
  const items = await buildAuditFeedItems(supabase, rows.slice(0, limit));
  return { items, hasMore: rows.length > limit, error: null };
}

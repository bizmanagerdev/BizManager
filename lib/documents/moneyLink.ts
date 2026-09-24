import { createSupabaseBrowserClient } from "@/lib/supabase/client";

// ────────────────────────────────────────────────────────────────────────────
// Money documents ↔ the ledger.
//
// A category flagged `is_money_doc` describes money that moved: an invoice, a
// receipt, a cheque, a fine. If the file is not linked to an `expense` or a
// `payment`, the paper exists but the books do not know about it — which is
// exactly the kind of gap that only shows up at reconciliation time.
//
// "Linked" means a `document_links` row with entity_type expense|payment. That
// plumbing already exists (app/api/financial-attachments/upload writes it when
// the file is uploaded FROM a transaction); this module covers the other
// direction, where the paper arrived first.
// ────────────────────────────────────────────────────────────────────────────

/** Days a money document is left alone before it counts as unlinked. A receipt
 *  uploaded this morning is not yet a problem. */
export const UNLINKED_MONEY_GRACE_DAYS = 3;

export const LEDGER_ENTITY_TYPES = ["expense", "payment"] as const;
export type LedgerEntityType = (typeof LEDGER_ENTITY_TYPES)[number];

/** True when this document should be, but is not, tied to a ledger row.
 *  `entityTypes` is what the archive already carries per document. */
export function isUnlinkedMoneyDocument(
  documentType: string | null | undefined,
  entityTypes: string[],
  moneyCodes: Set<string>
): boolean {
  const code = (documentType ?? "").trim();
  if (!code || !moneyCodes.has(code)) return false;
  return !entityTypes.some((t) => (LEDGER_ENTITY_TYPES as readonly string[]).includes(t));
}

export type LedgerCandidate = {
  id: string;
  entityType: LedgerEntityType;
  label: string;
  date: string | null;
  amount: number | null;
};

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Expenses and payments that could be the transaction behind a document.
 * Ordered newest-first; `query` matches the free-text description/vendor, and
 * an amount typed into the same box matches the figure.
 */
export async function findLedgerCandidates(query: string): Promise<LedgerCandidate[]> {
  const supabase = createSupabaseBrowserClient();
  const text = query.trim();
  const asAmount = num(text.replace(/[^\d.]/g, ""));

  const [expensesRes, paymentsRes] = await Promise.all([
    supabase
      .from("expenses")
      .select("id,expense_date,amount,description,vendor,category")
      .order("expense_date", { ascending: false })
      .limit(40),
    supabase
      .from("payments")
      .select("id,payment_date,amount_total,payment_method,check_number")
      .order("payment_date", { ascending: false })
      .limit(40),
  ]);

  const candidates: LedgerCandidate[] = [];

  for (const row of (expensesRes.data ?? []) as Record<string, unknown>[]) {
    const id = str(row.id);
    if (!id) continue;
    candidates.push({
      id,
      entityType: "expense",
      label: str(row.description) ?? str(row.vendor) ?? str(row.category) ?? "הוצאה",
      date: str(row.expense_date),
      amount: num(row.amount),
    });
  }

  for (const row of (paymentsRes.data ?? []) as Record<string, unknown>[]) {
    const id = str(row.id);
    if (!id) continue;
    const check = str(row.check_number);
    candidates.push({
      id,
      entityType: "payment",
      label: check ? `תשלום · צ׳ק ${check}` : "תשלום",
      date: str(row.payment_date),
      amount: num(row.amount_total),
    });
  }

  const filtered = text
    ? candidates.filter((c) => {
        if (c.label.includes(text)) return true;
        // Typing "1200" should find the ₪1,200 row, not just text matches.
        return asAmount !== null && c.amount !== null && Math.abs(c.amount - asAmount) < 0.01;
      })
    : candidates;

  return filtered
    .sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")))
    .slice(0, 25);
}

/** Attach a document to an expense or payment. RLS `document_links_admin_full` /
 *  `_office_full` covers this, the same way updateDocumentTag writes directly. */
export async function linkDocumentToLedger(
  documentId: string,
  entityType: LedgerEntityType,
  entityId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createSupabaseBrowserClient();

  // document_links has no unique constraint, so dedupe here rather than
  // creating a second identical row (the same thing the task-attachment
  // upload route does).
  const existing = await supabase
    .from("document_links")
    .select("id")
    .eq("document_id", documentId)
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .limit(1);
  if (!existing.error && (existing.data ?? []).length > 0) return { ok: true };

  const { error } = await supabase
    .from("document_links")
    .insert({ document_id: documentId, entity_type: entityType, entity_id: entityId });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

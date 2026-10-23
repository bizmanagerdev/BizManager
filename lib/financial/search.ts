import type { FinancialEntry } from "@/lib/financial/types";
import { hourOf, prepareListSearch, type ListSearchQuery, type SearchRecord } from "@/lib/search/listSearch";

// The ledger's (תזרים) search, by the global search's rules (owner,
// 2026-10-19: "searching 1447 there finds nothing"): an entry is found by its
// amount, any of its days, the hour it was typed in, and its words. What the
// row shows is painted there; the rest is said under it.

/** Shown on the desktop row's detail line — painted there, so not repeated under it. */
export const LEDGER_DESKTOP_DETAIL_LABELS = ["אמצעי תשלום", "אסמכתא", "הוזן ע״י", "נרשם"] as const;
/** The same on the phone's ledger card (its chips line). */
export const LEDGER_MOBILE_DETAIL_LABELS = ["אמצעי תשלום", "אסמכתא", "הוזן ע״י"] as const;

export function ledgerSearchRecord(entry: FinancialEntry): SearchRecord {
  return {
    text: [
      [null, entry.description],
      [null, entry.domainName],
      [null, entry.sourceLabel],
      ["אמצעי תשלום", entry.paymentMethodLabel],
      ["אסמכתא", entry.reference],
      ["הערה", entry.notes ?? entry.expenseNotes],
      ["קטגוריה", entry.expenseCategory],
      ["תיאור", entry.expenseDescriptionRaw],
      ["הוזן ע״י", entry.recordedByName],
      ["שעת רישום", hourOf(entry.createdAt)],
      // Everything else the entry was built from (a lender, a worker…), last.
      ["פרטים", entry.searchText],
    ],
    amounts: [
      [null, entry.amount],
      // A row in US$ or C$ is found by its dollars too.
      [null, entry.foreign?.amount ?? null],
      ["שולם", entry.expensePaidAmount],
    ],
    dates: [
      [null, entry.flowDate],
      ["נרשם", entry.recordedDate],
      ["מועד פירעון", entry.dueDate],
      ["שולם בתאריך", entry.expensePaidDate],
      ["הוזן", entry.createdAt],
    ],
  };
}

// The server filters thousands of entries with one query: read it once.
let lastQuery: { text: string; search: ListSearchQuery | null } | null = null;

/** `query` read once and kept, for a filter called entry by entry. */
export function ledgerQuery(query: string): ListSearchQuery | null {
  if (lastQuery?.text !== query) lastQuery = { text: query, search: prepareListSearch(query) };
  return lastQuery.search;
}

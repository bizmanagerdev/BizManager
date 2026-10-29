"use client";

import { useEffect } from "react";

/** The expense window's code (~3,400 lines, loaded only when first opened). */
export const loadExpenseDialog = () => import("@/components/expenses/ExpenseDialog");

/**
 * A link to one expense (?focus=expense:<id>, from the activity log, a search,
 * an alert) opens that expense's window on this page. Its code used to start
 * loading only once the whole page had been worked out and the row found — so
 * on a cold start the two waits came one after the other (owner, 2026-10-29:
 * "sometimes it takes very long till it opens"). Asked for at once, it loads
 * while the page is being worked out.
 */
export function useExpenseLinkPreload(focusId: string | null | undefined) {
  const wantsExpense = Boolean(focusId?.startsWith("expense:"));
  useEffect(() => {
    if (wantsExpense) void loadExpenseDialog();
  }, [wantsExpense]);
}

import AppShell from "@/components/layout/AppShell";
import { CashFlowSkeleton } from "./FinancialSkeleton";
import FinancialLoadingBody from "./FinancialLoadingBody";
import BankSkeleton from "./bank/BankSkeleton";

// Streamed instantly while the (heavy) cash-flow data loads, so TTFB = time-to-shell.
// The page's own shape (CashFlowSkeleton): the tab bar with its actions, then
// the history card — cards on a phone, the table from md — so the swap is
// shift-free. Every /financial/* page whose shape differs has its own — and
// since this one shows first on the way to them, it takes the accounts page's
// shape there (FinancialLoadingBody).
export default function FinancialLoading() {
  return (
    <AppShell>
      <FinancialLoadingBody
        cashFlow={<CashFlowSkeleton routeLoading />}
        bank={<BankSkeleton routeLoading />}
      />
    </AppShell>
  );
}

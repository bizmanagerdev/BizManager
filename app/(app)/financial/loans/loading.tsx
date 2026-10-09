import AppShell from "@/components/layout/AppShell";
import DebtsSkeleton from "./DebtsSkeleton";

// Streamed instantly while the debts load, so the page shell shows at once.
// The open tab's own shape (DebtsSkeleton): the tab bar, then the debts list's
// totals, filters and kind sections — table from md, cards below — or the
// loans tab's boxes and loan cards, or the report's cards, to keep the swap
// shift-free.
export default function DebtsLoading() {
  return (
    <AppShell>
      <DebtsSkeleton />
    </AppShell>
  );
}

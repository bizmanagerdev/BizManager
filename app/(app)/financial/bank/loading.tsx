import AppShell from "@/components/layout/AppShell";
import BankSkeleton from "./BankSkeleton";

// Streamed instantly while the accounts and their registers load, so TTFB =
// time-to-shell. The page's own shape (it used to get the cash-flow page's):
// the account strip, the open account's register and the note under it.
export default function BankLoading() {
  return (
    <AppShell>
      <BankSkeleton routeLoading />
    </AppShell>
  );
}

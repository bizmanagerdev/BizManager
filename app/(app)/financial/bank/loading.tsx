import AppShell from "@/components/layout/AppShell";
import BankSkeleton from "./BankSkeleton";

// Streamed instantly while the accounts and their registers load, so TTFB =
// time-to-shell. The page's own shape (it used to get the cash-flow page's):
// the account strip, the open account's register and the note under it. Its
// strip is as tall as the page's last stood on this device — set before the
// first paint (lib/ui/bank-strip-height.ts), not read here: a loading screen
// that waits for anything is itself waited for, and meanwhile /financial's
// (the cash-flow page's shape) showed first (2026-10-28).
export default function BankLoading() {
  return (
    <AppShell>
      <BankSkeleton routeLoading />
    </AppShell>
  );
}

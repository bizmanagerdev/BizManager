import AppShell from "@/components/layout/AppShell";
import TaxesSkeleton from "./TaxesSkeleton";

// Streamed instantly while the VAT figures load, so TTFB = time-to-shell. The
// page's own shape (it used to get the cash-flow page's): heading, headline
// card, the four boxes, the payments card.
export default function TaxesLoading() {
  return (
    <AppShell>
      <TaxesSkeleton />
    </AppShell>
  );
}

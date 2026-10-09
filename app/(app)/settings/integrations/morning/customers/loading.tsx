import AppShell from "@/components/layout/AppShell";
import { MorningCustomersSkeleton } from "../MorningSkeletons";

// Streamed instantly while the customers list loads, so TTFB = time-to-shell.
// The page's own shape — its heading and the customers card, rows blank —
// instead of the settings page's tab bar it used to inherit.
export default function MorningCustomersLoading() {
  return (
    <AppShell>
      <div className="space-y-4" data-route-loading="true">
        <MorningCustomersSkeleton />
      </div>
    </AppShell>
  );
}

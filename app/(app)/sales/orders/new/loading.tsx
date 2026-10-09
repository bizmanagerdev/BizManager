import AppShell from "@/components/layout/AppShell";
import OrderFormSkeleton from "./OrderFormSkeleton";

// The new-order page's own loading screen — it used to get the sales list's
// placeholder, then grey blocks: the order form at its first step.
export default function NewOrderLoading() {
  return (
    <AppShell>
      <div className="space-y-4" data-route-loading="true">
        <OrderFormSkeleton />
      </div>
    </AppShell>
  );
}

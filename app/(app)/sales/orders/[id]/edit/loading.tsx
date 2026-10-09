import AppShell from "@/components/layout/AppShell";
import EditOrderSkeleton from "./EditOrderSkeleton";

// The edit page's own loading screen — it used to get the order page's (the
// order's cards), then grey blocks: its heading and the order form.
export default function EditOrderLoading() {
  return (
    <AppShell>
      <EditOrderSkeleton />
    </AppShell>
  );
}

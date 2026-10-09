import AppShell from "@/components/layout/AppShell";
import PropertiesLoadingBody from "@/app/(app)/properties/PropertiesLoadingBody";

// Streamed instantly while the properties list loads, so TTFB = time-to-shell.
// The list's own shape (PropertiesSkeleton — the heading and add button, the
// property cards with their figures) to keep the swap shift-free; on the way
// to a property's page, that page's shape instead.
export default function PropertiesLoading() {
  return (
    <AppShell>
      <PropertiesLoadingBody />
    </AppShell>
  );
}

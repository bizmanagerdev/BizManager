import AppShell from "@/components/layout/AppShell";
import PropertyPageSkeleton from "@/app/(app)/properties/[id]/PropertyPageSkeleton";

// Streamed instantly while this property's data loads, so TTFB = time-to-shell,
// not time-to-all-queries. The page's own shape (PropertyPageSkeleton): its
// heading, the four figure cards, the details / lease / activity cards.
export default function PropertyDetailLoading() {
  return (
    <AppShell>
      <PropertyPageSkeleton routeLoading />
    </AppShell>
  );
}

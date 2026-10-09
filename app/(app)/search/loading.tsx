import AppShell from "@/components/layout/AppShell";
import SearchSkeleton from "./SearchSkeleton";

// Streamed instantly while the global search query runs, so TTFB =
// time-to-shell. The page's own shape (SearchSkeleton) — its heading, the
// query's card and the grouped result cards — to keep the swap shift-free.
export default function SearchLoading() {
  return (
    <AppShell>
      <div className="space-y-4" data-route-loading="true">
        <SearchSkeleton />
      </div>
    </AppShell>
  );
}

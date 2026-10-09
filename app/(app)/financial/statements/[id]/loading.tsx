import AppShell from "@/components/layout/AppShell";
import StatementDetailSkeleton from "./StatementDetailSkeleton";

// Streamed instantly while the statement's rows and pick-lists load, so TTFB =
// time-to-shell. The statement page's own shape (not the list's, which it
// would otherwise inherit): its heading and buttons, the rows' table.
export default function StatementDetailLoading() {
  return (
    <AppShell>
      <StatementDetailSkeleton routeLoading />
    </AppShell>
  );
}

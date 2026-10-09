import { cookies } from "next/headers";
import AppShell from "@/components/layout/AppShell";
import { PageStack } from "@/components/layout/page-layout";
import { PanelsFallback } from "@/app/(app)/dashboard/DashboardSections";
import { HELD_HEIGHTS_COOKIE } from "@/lib/ui/held-heights";

// Streamed instantly while the page's auth check runs, so the document's first
// byte (TTFB) no longer waits for any data. Renders the real AppShell (nav
// resolves from cached role) and the page's own frame — its backdrop, its
// pull-up, no heading (the greeting is in the top bar) — around the SAME
// placeholder the page's Suspense uses, from the same cookie (no I/O), so
// there's no visual jump as it hands off to the page.
export default async function DashboardLoading() {
  const heldRaw = (await cookies()).get(HELD_HEIGHTS_COOKIE)?.value;
  return (
    <AppShell>
      <div aria-hidden className="board-backdrop" />
      <PageStack className="-mt-2 md:-mt-3 lg:-mt-4" data-route-loading="true">
        <PanelsFallback heldRaw={heldRaw} />
      </PageStack>
    </AppShell>
  );
}

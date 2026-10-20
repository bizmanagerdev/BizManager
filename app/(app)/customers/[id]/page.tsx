import { Suspense } from "react";
import { notFound } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { requireStaffPage } from "@/lib/auth/roleAccess";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { israelDateKey } from "@/lib/timezone";
import { startCustomerPageReads, startCustomerServerReads } from "@/app/(app)/customers/[id]/loadCustomerPage";
import CustomerPageView from "@/app/(app)/customers/[id]/CustomerPageView";
import LocalCustomerPage from "@/app/(app)/customers/[id]/LocalCustomerPage";
import CustomerPageServerCheck from "@/app/(app)/customers/[id]/CustomerPageServerCheck";
import DeviceFrameMark from "@/components/powersync/DeviceFrameMark";
import { serverRenderedAt } from "@/lib/loaded-at";
import { deviceCheckDue, devicePageOn } from "@/lib/powersync/device-check";
import { LOCAL_DATA_PAGES, LOCAL_DATA_SHADOW } from "@/lib/powersync/config";

// A customer's page. Its reads go out at once — alongside the "who's asking"
// check, and each as soon as what it needs is in (loadCustomerPage.ts). They
// run under the caller's own RLS whatever their role, and a caller who isn't
// staff is still redirected below before anything is rendered. With the
// device version on for everyone (LOCAL_DATA_PAGES.customerPage) they wait for
// the check instead, and go out only for people without a device copy.
//
// The page shows as soon as the customer and its money are read; the payments,
// the documents and the history follow into their folded sections as they
// arrive (CustomerPageView, through Suspense).

export default async function CustomerDetailsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ data?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const serverVersion = query?.data === "server";
  const supabase = await createSupabaseServerClient();
  const profilePromise = requireStaffPage();
  const viewer = {
    role: profilePromise.then(
      ({ profile }) => profile.role ?? "",
      () => ""
    ),
    viewerId: profilePromise.then(
      ({ profile }) => profile.id,
      () => ""
    ),
  };
  const startReads = () => {
    const reads = startCustomerPageReads(supabase, id, viewer);
    // Awaited after the check; until then a redirect from it mustn't leave the
    // reads as unhandled rejections.
    reads.top.catch(() => {});
    return reads;
  };
  const earlyReads = LOCAL_DATA_PAGES.customerPage && !serverVersion ? null : startReads();

  const { profile } = await profilePromise;

  // The device version: the customer, his money, orders, projects and the
  // rest are worked out from this person's on-device copy (LocalCustomerPage);
  // what only the server reads follows from here as it comes. ?data=server is
  // the way back when the copy can't serve it; a device whose copy is still
  // incomplete gets the server version at once.
  if (!serverVersion && (await devicePageOn("customerPage", profile))) {
    const serverReads = startCustomerServerReads(supabase, id, viewer);
    // Once a day per device, the server's own reading of the customer too —
    // streamed after the page, for the device to compare (lib/powersync/device-check.ts).
    const checkDue = LOCAL_DATA_SHADOW.customerPage && (await deviceCheckDue("customerPage"));
    return (
      <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
        {/* Saved by the service worker, so this customer opens at once next time (public/sw.js). */}
        <DeviceFrameMark page={`customer:${id}`} renderedAt={serverRenderedAt()} />
        <LocalCustomerPage
          id={id}
          viewer={{ userId: profile.id, role: profile.role ?? "", locale: profile.locale }}
          serverReads={{
            server: serverReads.server,
            documents: serverReads.documents,
            history: profile.role === "admin" ? serverReads.history : null,
          }}
        />
        {checkDue ? (
          <Suspense fallback={null}>
            <CustomerPageServerCheck
              supabase={supabase}
              id={id}
              userId={profile.id}
              role={profile.role ?? ""}
              locale={profile.locale}
            />
          </Suspense>
        ) : null}
      </AppShell>
    );
  }

  const reads = earlyReads ?? startReads();
  const top = await reads.top;
  if (!top) notFound();

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <CustomerPageView
        top={top}
        payments={reads.payments}
        documents={reads.documents}
        history={profile.role === "admin" ? reads.history : null}
        viewer={{ id: profile.id, role: profile.role ?? "" }}
        today={israelDateKey()}
      />
    </AppShell>
  );
}

import { Suspense } from "react";
import dynamic from "next/dynamic";
import { notFound } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { requireStaffPage } from "@/lib/auth/roleAccess";
import { loadPropertyPageCore, loadPropertyServerParts, mergePropertyPage } from "@/lib/properties";
import DashboardLocalShadow from "@/components/powersync/DashboardLocalShadow";
import DeviceFrameMark from "@/components/powersync/DeviceFrameMark";
import { serverRenderedAt } from "@/lib/loaded-at";
import { deviceCheckDue, devicePageOn } from "@/lib/powersync/device-check";
import { LOCAL_DATA_PAGES, LOCAL_DATA_SHADOW, localDataEnabledFor } from "@/lib/powersync/config";
import { israelDateKey } from "@/lib/timezone";
import { PropertyDetailBodySkeleton } from "./PropertyPageSkeleton";
import LocalPropertyPage from "./LocalPropertyPage";
import PropertyPageServerCheck from "./PropertyPageServerCheck";

// While its code loads: the loading screen's own body (the heading and the
// figure cards above it are already the page's), so nothing swaps in between.
const PropertyDetailClient = dynamic(() => import("./PropertyDetailClient"), {
  loading: () => <PropertyDetailBodySkeleton />,
});

export const revalidate = 30;

export default async function PropertyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ data?: string }>;
}) {
  const [{ id }, query, { profile, supabase }] = await Promise.all([params, searchParams, requireStaffPage()]);
  const serverVersion = query?.data === "server";

  // The page's reads (lib/properties.ts): the core — what the device copy also
  // holds — and the server's part (documents, files, the recurring bills),
  // together. With the device version on for everyone they wait for the check
  // instead, and go out only for people without a device copy.
  const startReads = () => {
    const reads = Promise.all([loadPropertyPageCore(supabase, id), loadPropertyServerParts(supabase, id)]);
    // Awaited after the check; until then a failure mustn't be reported as unhandled.
    reads.catch(() => {});
    return reads;
  };
  const earlyReads = LOCAL_DATA_PAGES.propertyPage && !serverVersion ? null : startReads();

  // The device version: the core worked out from this person's on-device copy
  // (LocalPropertyPage); the server's part follows from here as it comes.
  // ?data=server is the way back when the copy can't serve it; a device whose
  // copy is still incomplete gets the server version at once.
  if (!serverVersion && (await devicePageOn("propertyPage", profile))) {
    // Once a day per device, the server's own reading of the property too —
    // streamed after the page, for the device to compare (lib/powersync/device-check.ts).
    const checkDue = LOCAL_DATA_SHADOW.propertyPage && (await deviceCheckDue("propertyPage"));
    return (
      <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
        {/* Saved by the service worker, so this property opens at once next time (public/sw.js). */}
        <DeviceFrameMark page={`property:${id}`} renderedAt={serverRenderedAt()} />
        <LocalPropertyPage
          id={id}
          viewer={{ userId: profile.id, role: profile.role ?? "", locale: profile.locale }}
          serverParts={loadPropertyServerParts(supabase, id)}
          currentUserRole={profile.role}
        />
        {checkDue ? (
          <Suspense fallback={null}>
            <PropertyPageServerCheck
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

  const [core, parts] = await (earlyReads ?? startReads());
  if (!core) notFound();
  const { property, activity } = mergePropertyPage(core, parts);

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      {/* The device-copy check for this page (lib/powersync/dashboard-shadow.ts):
          worked out on the device too, and compared. */}
      {LOCAL_DATA_SHADOW.propertyPage && localDataEnabledFor(profile.role) ? (
        <DashboardLocalShadow
          snapshot={{
            renderedAt: new Date().toISOString(),
            userId: profile.id,
            role: profile.role ?? "",
            locale: profile.locale,
            todayIso: israelDateKey(),
            cards: { propertyPage: { filters: { id }, core } },
          }}
        />
      ) : null}
      {/* One details page, like a project's or an order's (owner, 2026-10-20):
          the heading, the head row and the money are all the client's. */}
      <PropertyDetailClient
        propertyId={id}
        property={property}
        activity={activity}
        users={core.users}
        salaryAgreements={core.salaryAgreements}
        currentUserId={profile.id}
        currentUserRole={profile.role}
      />
    </AppShell>
  );
}

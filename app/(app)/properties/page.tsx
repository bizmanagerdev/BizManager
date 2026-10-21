import { Suspense } from "react";
import AppShell from "@/components/layout/AppShell";
import { requireStaffPage } from "@/lib/auth/roleAccess";
import { loadProperties } from "@/lib/properties";
import DashboardLocalShadow from "@/components/powersync/DashboardLocalShadow";
import DeviceFrameMark from "@/components/powersync/DeviceFrameMark";
import { serverRenderedAt } from "@/lib/loaded-at";
import { deviceCheckDue, devicePageOn } from "@/lib/powersync/device-check";
import { LOCAL_DATA_PAGES, LOCAL_DATA_SHADOW, localDataEnabledFor } from "@/lib/powersync/config";
import { israelDateKey } from "@/lib/timezone";
import PropertiesClient from "./PropertiesClient";
import LocalPropertiesPage from "./LocalPropertiesPage";
import PropertiesServerCheck from "./PropertiesServerCheck";

export const revalidate = 30;

export default async function PropertiesPage({ searchParams }: { searchParams?: Promise<{ data?: string }> }) {
  const [{ profile, supabase }, query] = await Promise.all([requireStaffPage(), searchParams]);
  const serverVersion = query?.data === "server";

  // With the device version on for everyone (LOCAL_DATA_PAGES.properties) the
  // read waits for the check instead, and goes out only for people without a
  // device copy.
  const startRead = () =>
    loadProperties(supabase).then(
      (properties) => ({ properties, failed: false }),
      // As before: an empty list rather than an error page.
      () => ({ properties: [], failed: true })
    );
  const earlyRead = LOCAL_DATA_PAGES.properties && !serverVersion ? null : startRead();

  // The device version: the list worked out from this person's on-device copy
  // (LocalPropertiesPage). ?data=server is the way back when the copy can't
  // serve it; a device whose copy is still incomplete gets the server version
  // at once.
  if (!serverVersion && (await devicePageOn("properties", profile))) {
    // Once a day per device, the server's own list too — streamed after the
    // page, for the device to compare (lib/powersync/device-check.ts).
    const checkDue = LOCAL_DATA_SHADOW.properties && (await deviceCheckDue("properties"));
    return (
      <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
        <DeviceFrameMark page="properties" renderedAt={serverRenderedAt()} />
        <LocalPropertiesPage viewer={{ userId: profile.id, role: profile.role ?? "", locale: profile.locale }} />
        {checkDue ? (
          <Suspense fallback={null}>
            <PropertiesServerCheck
              supabase={supabase}
              userId={profile.id}
              role={profile.role ?? ""}
              locale={profile.locale}
            />
          </Suspense>
        ) : null}
      </AppShell>
    );
  }

  const { properties, failed } = await (earlyRead ?? startRead());

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      {/* The device-copy check for this list (lib/powersync/dashboard-shadow.ts):
          worked out on the device too, and compared. */}
      {LOCAL_DATA_SHADOW.properties && localDataEnabledFor(profile.role) && !failed ? (
        <DashboardLocalShadow
          snapshot={{
            renderedAt: new Date().toISOString(),
            userId: profile.id,
            role: profile.role ?? "",
            locale: profile.locale,
            todayIso: israelDateKey(),
            cards: { propertiesList: { properties } },
          }}
        />
      ) : null}
      <PropertiesClient properties={properties} />
    </AppShell>
  );
}

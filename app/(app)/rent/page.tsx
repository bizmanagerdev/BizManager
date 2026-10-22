import { Suspense } from "react";
import AppShell from "@/components/layout/AppShell";
import { requireStaffPage } from "@/lib/auth/roleAccess";
import { loadRentRoll } from "@/lib/properties";
import DashboardLocalShadow from "@/components/powersync/DashboardLocalShadow";
import DeviceFrameMark from "@/components/powersync/DeviceFrameMark";
import { serverRenderedAt } from "@/lib/loaded-at";
import { deviceCheckDue, devicePageOn } from "@/lib/powersync/device-check";
import { LOCAL_DATA_PAGES, LOCAL_DATA_SHADOW, localDataEnabledFor } from "@/lib/powersync/config";
import { israelDateKey } from "@/lib/timezone";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import RentRollClient from "./RentRollClient";
import LocalRentRollPage from "./LocalRentRollPage";
import RentRollServerCheck from "./RentRollServerCheck";

export const revalidate = 30;

// The rent roll (owner, 2026-10-21): every lease's rent for the month on one
// page, marked from its row (RentRollClient).
export default async function RentRollPage({ searchParams }: { searchParams?: Promise<{ data?: string }> }) {
  const [{ profile, supabase }, query] = await Promise.all([requireStaffPage(), searchParams]);
  const serverVersion = query?.data === "server";

  // With the device version on for everyone (LOCAL_DATA_PAGES.rentRoll) the
  // read waits for the check instead, and goes out only for people without a
  // device copy.
  const startRead = () =>
    loadRentRoll(supabase).then(
      (data) => data,
      () => null
    );
  const earlyRead = LOCAL_DATA_PAGES.rentRoll && !serverVersion ? null : startRead();

  // The device version: the roll worked out from this person's on-device copy
  // (LocalRentRollPage). ?data=server is the way back when the copy can't
  // serve it; a device whose copy is still incomplete gets the server version
  // at once.
  if (!serverVersion && (await devicePageOn("rentRoll", profile))) {
    // Once a day per device, the server's own roll too — streamed after the
    // page, for the device to compare (lib/powersync/device-check.ts).
    const checkDue = LOCAL_DATA_SHADOW.rentRoll && (await deviceCheckDue("rentRoll"));
    return (
      <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
        <DeviceFrameMark page="rentRoll" renderedAt={serverRenderedAt()} />
        <LocalRentRollPage viewer={{ userId: profile.id, role: profile.role ?? "", locale: profile.locale }} />
        {checkDue ? (
          <Suspense fallback={null}>
            <RentRollServerCheck supabase={supabase} userId={profile.id} role={profile.role ?? ""} locale={profile.locale} />
          </Suspense>
        ) : null}
      </AppShell>
    );
  }

  const data = await (earlyRead ?? startRead());

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      {/* The device-copy check for this page (lib/powersync/dashboard-shadow.ts):
          worked out on the device too, and compared. */}
      {LOCAL_DATA_SHADOW.rentRoll && localDataEnabledFor(profile.role) && data ? (
        <DashboardLocalShadow
          snapshot={{
            renderedAt: new Date().toISOString(),
            userId: profile.id,
            role: profile.role ?? "",
            locale: profile.locale,
            todayIso: israelDateKey(),
            cards: { rentRoll: { data } },
          }}
        />
      ) : null}
      {data ? (
        <RentRollClient data={data} />
      ) : (
        // A read that failed isn't "nobody owes anything".
        <Card>
          <CardContent className="p-4">
            <EmptyState dense>לא הצלחנו לטעון את השכירות. נסו לרענן את הדף.</EmptyState>
          </CardContent>
        </Card>
      )}
    </AppShell>
  );
}

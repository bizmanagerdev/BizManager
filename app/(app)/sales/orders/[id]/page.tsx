import { Suspense } from "react";
import AppShell from "@/components/layout/AppShell";
import { requireStaffPage } from "@/lib/auth/roleAccess";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadOrderPageCore, orderPaymentIds, readOrderPayments } from "@/lib/orders/order-page";
import { deviceCheckDue, devicePageOn } from "@/lib/powersync/device-check";
import { LOCAL_DATA_PAGES, LOCAL_DATA_SHADOW } from "@/lib/powersync/config";
import { loadOrderPageExtras } from "@/app/(app)/sales/orders/[id]/loadOrderPageExtras";
import OrderPageView from "@/app/(app)/sales/orders/[id]/OrderPageView";
import LocalOrderPage from "@/app/(app)/sales/orders/[id]/LocalOrderPage";
import OrderServerCheck from "@/app/(app)/sales/orders/[id]/OrderServerCheck";

export default async function SalesOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ data?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const serverVersion = query?.data === "server";
  // The server version's reads go out at once — alongside the "who's asking"
  // check, and each as soon as what it needs is in (lib/orders/order-page.ts,
  // loadOrderPageExtras.ts). They run under the caller's own RLS whatever
  // their role, and a caller who isn't staff is still redirected below before
  // anything is rendered. With the device version on for everyone
  // (LOCAL_DATA_PAGES.orders) they wait for the check instead, and go out only
  // for people without a device copy.
  const supabase = await createSupabaseServerClient();
  const profilePromise = requireStaffPage();
  const startServerReads = () => {
    const payments = readOrderPayments(supabase, id);
    const core = loadOrderPageCore(supabase, id, { payments });
    const extras = loadOrderPageExtras(supabase, {
      id,
      paymentIds: payments.then(orderPaymentIds),
      // The history is admin only, mirroring /activity access — read once the role is known.
      withActivity: profilePromise.then(
        ({ profile }) => profile.role === "admin",
        () => false
      ),
    });
    // Awaited after the check; until then a redirect from it mustn't leave
    // them as unhandled rejections.
    core.catch(() => {});
    return { core, extras };
  };
  const earlyReads = LOCAL_DATA_PAGES.orders && !serverVersion ? null : startServerReads();

  const { profile } = await profilePromise;
  const viewerName = profile.full_name ?? profile.email ?? null;

  // The device version: the order, its lines, payments and money and the
  // customer are worked out from this person's on-device copy
  // (LocalOrderPage); its documents, photos and history — which only the
  // server reads — follow from here as they come. ?data=server is the way back
  // when the copy can't serve it; a device whose copy is still incomplete gets
  // the server version at once.
  if (!serverVersion && (await devicePageOn("orders", profile))) {
    const extras =
      earlyReads?.extras ??
      loadOrderPageExtras(supabase, {
        id,
        paymentIds: readOrderPayments(supabase, id).then(orderPaymentIds),
        withActivity: Promise.resolve(profile.role === "admin"),
      });
    // Once a day per device, the server's own reading of the order too —
    // streamed after the page, for the device to compare (lib/powersync/device-check.ts).
    const checkDue = LOCAL_DATA_SHADOW.orders && (await deviceCheckDue("orders"));
    return (
      <AppShell userName={viewerName ?? undefined} viewerRole={profile.role}>
        <LocalOrderPage
          id={id}
          viewer={{ userId: profile.id, role: profile.role ?? "", locale: profile.locale, name: viewerName }}
          extras={extras}
        />
        {checkDue ? (
          <Suspense fallback={null}>
            <OrderServerCheck
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

  const { core, extras } = earlyReads ?? startServerReads();
  const [coreResult, extrasResult] = await Promise.all([core, extras]);

  return (
    <AppShell userName={viewerName ?? undefined} viewerRole={profile.role}>
      <OrderPageView id={id} core={coreResult} extras={extrasResult} viewer={{ role: profile.role ?? "", name: viewerName }} />
    </AppShell>
  );
}

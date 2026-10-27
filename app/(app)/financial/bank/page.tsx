// Aliased: this route also exports its own `dynamic` (route-segment config,
// below) which would otherwise collide with next/dynamic's default export.
import nextDynamic from "next/dynamic";
import { Suspense, type CSSProperties, type ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import { BANK_STRIP_COOKIE, bankStripStyle } from "@/lib/ui/bank-strip-height";
import DeviceFrameMark from "@/components/powersync/DeviceFrameMark";
import { serverRenderedAt } from "@/lib/loaded-at";
import { deviceCheckDue, devicePageOn } from "@/lib/powersync/device-check";
import { LOCAL_DATA_SHADOW } from "@/lib/powersync/config";
import BankSkeleton from "./BankSkeleton";
import LocalBankPage from "./LocalBankPage";
import BankServerCheck from "./BankServerCheck";
import { loadBankPage } from "./loadBankPage";

// The same placeholder as loading.tsx while the client's code loads.
const BankClient = nextDynamic(() => import("./BankClient"), {
  loading: () => <BankSkeleton />,
});

export const dynamic = "force-dynamic";

/**
 * חשבונות — every account's balance, and the register of whichever one is open.
 *
 * The register is meant to be read next to the bank's own site in a split
 * window, so the page carries a quick-entry row for typing what's missing
 * straight in. (A previous version imported and matched statement files; it was
 * more machinery than the job needed and was removed.)
 */
export default async function BankPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string; data?: string }>;
}) {
  const { profile, supabase } = await requireProfile();
  // חשבונות (balances/management) is admin-only. Office still assigns an account
  // when recording payments via the AccountSelect picker (read-only GET), just not here.
  if (profile.role !== "admin") {
    redirect("/no-access");
  }

  const params = await searchParams;
  // For the placeholder while the page's code loads (BankSkeleton's strip).
  const strip = bankStripStyle((await cookies()).get(BANK_STRIP_COOKIE)?.value);
  const shell = (content: ReactNode) => (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <div className="contents" style={strip as CSSProperties | undefined}>
        {content}
      </div>
    </AppShell>
  );

  // The device version: the page worked out from this person's on-device copy
  // (LocalBankPage) — only where the copy has the accounts tables (sync rules
  // v1.14). ?data=server is the way back when the copy can't serve it.
  if (params.data !== "server" && (await devicePageOn("bank", profile))) {
    // Once a day per device, the server's own page too — streamed after the
    // page, for the device to compare (lib/powersync/device-check.ts).
    const checkDue = LOCAL_DATA_SHADOW.bank && (await deviceCheckDue("bank"));
    return shell(
      <>
        <DeviceFrameMark page="bank" renderedAt={serverRenderedAt()} />
        <LocalBankPage viewer={{ userId: profile.id, role: profile.role ?? "", locale: profile.locale }} />
        {checkDue ? (
          <Suspense fallback={null}>
            <BankServerCheck supabase={supabase} userId={profile.id} role={profile.role ?? ""} locale={profile.locale} />
          </Suspense>
        ) : null}
      </>
    );
  }

  const data = await loadBankPage(supabase);
  return shell(
    <BankClient
      accounts={data.accounts}
      loans={data.loans}
      initialAccountId={params.account ?? ""}
      projects={data.projects}
      recurringProperties={data.recurringProperties}
      merchantMemory={data.merchantMemory}
      dataIncomplete={data.dataIncomplete}
      fxRates={data.fxRates}
    />
  );
}

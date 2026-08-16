import { Suspense } from "react";
import AppShell from "@/components/layout/AppShell";
import { PageStack } from "@/components/layout/page-layout";
import { requireProfile } from "@/lib/auth/requireProfile";
import DashboardGreeting from "@/components/dashboard/DashboardGreeting";
import DashboardHeaderDate from "@/components/dashboard/DashboardHeaderDate";
import DashboardCustomizer from "@/components/dashboard/DashboardCustomizer";
import { sanitizePrefs } from "@/lib/dashboard/widgets";
import { DashboardPanels, PanelsFallback } from "@/app/(app)/dashboard/DashboardSections";
import WorkerShiftPanel from "@/app/(app)/dashboard/WorkerShiftPanel";

export const revalidate = 60;

export default async function DashboardPage() {
  // Only the (fast, indexed) auth/profile check is awaited up front; the greeting
  // renders immediately after it and the panels below stream on their own.
  //
  // There is no quick-action grid here any more — every create flow lives behind
  // the + (top bar on desktop, the raised FAB in the bottom nav on a phone), so
  // it's the same menu on every screen instead of one set on the dashboard and a
  // shorter one everywhere else. That also drops this page's heaviest fetch: the
  // picker data (customers / products / projects / orders / workers) is now
  // loaded on demand by the menu itself, once, when it's first opened.
  const { profile } = await requireProfile();

  const isWorker = profile.role === "worker";
  // Prefs ride along on the profile (requireProfile's single `users` query), so
  // the shell no longer waits on a second round-trip just to hydrate the customizer.
  const dashboardPrefs = sanitizePrefs(profile.dashboard_prefs);

  const firstName = profile.full_name?.trim().split(/\s+/)[0] ?? "";
  const currentHour = new Date().getHours();
  const greeting = currentHour < 12 ? "בוקר טוב" : currentHour < 18 ? "צהריים טובים" : "ערב טוב";
  const now = new Date();
  const greetingDate = `${new Intl.DateTimeFormat("he-IL", { weekday: "long" }).format(now)} · ${new Intl.DateTimeFormat(
    "he-IL",
    { day: "numeric", month: "long", year: "numeric" }
  ).format(now)}`;
  // The mobile bar's version — no year, so it fits the one shrink-to-fit line.
  const headerDate = `${new Intl.DateTimeFormat("he-IL", { weekday: "long" }).format(now)} · ${new Intl.DateTimeFormat(
    "he-IL",
    { day: "numeric", month: "long" }
  ).format(now)}`;

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <PageStack>
        {/* Phone header text: today's date instead of the word "דשבורד". */}
        <DashboardHeaderDate initialDate={headerDate} />
        <section className="flex items-start justify-between gap-3">
          {/* min-w-0 lets this flex item shrink below its content so a long
              (unbreakable) name wraps instead of pushing the row — and the whole
              page — wider than a phone screen. */}
          <div className="min-w-0 flex-1 text-right">
            <DashboardGreeting name={firstName} initialGreeting={greeting} initialDate={greetingDate} />
          </div>
          {/* Nothing worth rearranging on a worker's board — it's the clock, his
              tasks and his deliveries — so the customizer would be a control
              over three fixed cards. */}
          {isWorker ? null : (
            <div className="shrink-0">
              <DashboardCustomizer role={profile.role} initialPrefs={dashboardPrefs} />
            </div>
          )}
        </section>

        {/* A worker's day starts by clocking in, so the clock sits above
            everything else on his dashboard. Staff clock people in from the
            payroll queue instead, so they don't get this. */}
        {isWorker ? (
          <Suspense fallback={null}>
            <WorkerShiftPanel userId={profile.id} />
          </Suspense>
        ) : null}

        <Suspense fallback={<PanelsFallback />}>
          <DashboardPanels />
        </Suspense>
      </PageStack>
    </AppShell>
  );
}

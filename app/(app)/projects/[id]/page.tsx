import { Suspense } from "react";
import AppShell from "@/components/layout/AppShell";
import { requireStaffPage } from "@/lib/auth/roleAccess";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { sanitizeLedgerPrefs } from "@/lib/projectLedgerPrefs";
import { startProjectPageIdReads, startProjectPageReads } from "@/lib/projects/project-page";
import { deviceCheckDue, devicePageOn } from "@/lib/powersync/device-check";
import { LOCAL_DATA_PAGES, LOCAL_DATA_SHADOW } from "@/lib/powersync/config";
import { loadProjectPageExtras } from "@/app/(app)/projects/[id]/loadProjectPageExtras";
import { ProjectPageStreamed } from "@/app/(app)/projects/[id]/ProjectPageView";
import LocalProjectPage from "@/app/(app)/projects/[id]/LocalProjectPage";
import ProjectServerCheck from "@/app/(app)/projects/[id]/ProjectServerCheck";

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ data?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const serverVersion = query?.data === "server";
  // The server version's reads go out at once — alongside the "who's asking"
  // check, and each as soon as what it needs is in (lib/projects/project-page.ts).
  // They run under the caller's own RLS whatever their role, and a caller who
  // isn't staff is still redirected below before anything is rendered. With
  // the device version on for everyone (LOCAL_DATA_PAGES.projectPage) they
  // wait for the check instead, and go out only for people without a device copy.
  const supabase = await createSupabaseServerClient();
  const profilePromise = requireStaffPage();
  // The history is admin only, mirroring /activity access — read once the role is known.
  const withActivity = profilePromise.then(
    ({ profile }) => profile.role === "admin",
    () => false
  );
  const startServerReads = () => {
    const reads = startProjectPageReads(supabase, id);
    // The parts only the server reads — the documents and every row's files,
    // Morning documents, "entered by" from the change log, the history — go
    // out too, but the page doesn't wait for them: it shows as soon as the
    // project itself is read, and they fill in as they arrive.
    const extras = loadProjectPageExtras(supabase, {
      id,
      expenseIds: reads.expenseIds,
      sessionIds: reads.sessionIds,
      paymentIds: reads.paymentIds,
      withActivity,
    });
    // Awaited after the check; until then a redirect from it mustn't leave
    // the reads as unhandled rejections.
    reads.core.catch(() => {});
    return { core: reads.core, extras };
  };
  const earlyReads = LOCAL_DATA_PAGES.projectPage && !serverVersion ? null : startServerReads();

  const { profile } = await profilePromise;
  const ledgerPrefs = sanitizeLedgerPrefs(profile.ledger_prefs);

  // The device version: the project, its money, tasks and movements are worked
  // out from this person's on-device copy (LocalProjectPage); what only the
  // server reads follows from here as it comes — needing only the rows' ids,
  // not the whole page. ?data=server is the way back when the copy can't serve
  // it; a device whose copy is still incomplete gets the server version at once.
  if (!serverVersion && (await devicePageOn("projectPage", profile))) {
    const extras =
      earlyReads?.extras ?? loadProjectPageExtras(supabase, { id, ...startProjectPageIdReads(supabase, id), withActivity });
    // Once a day per device, the server's own reading of the project too —
    // streamed after the page, for the device to compare (lib/powersync/device-check.ts).
    const checkDue = LOCAL_DATA_SHADOW.projectPage && (await deviceCheckDue("projectPage"));
    return (
      <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
        <LocalProjectPage
          id={id}
          viewer={{ userId: profile.id, role: profile.role ?? "", locale: profile.locale, ledgerPrefs }}
          extras={extras}
        />
        {checkDue ? (
          <Suspense fallback={null}>
            <ProjectServerCheck
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
  const coreResult = await core;

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <ProjectPageStreamed id={id} core={coreResult} extras={extras} viewer={{ role: profile.role ?? "", ledgerPrefs }} />
    </AppShell>
  );
}

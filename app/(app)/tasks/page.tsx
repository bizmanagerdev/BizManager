import { redirect } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasSectionAccess, isStaffRole } from "@/lib/auth/roleAccess";
import { t } from "@/lib/i18n/t";
import { commonDict } from "@/lib/i18n/dictionaries/common";
import DashboardLocalShadow from "@/components/powersync/DashboardLocalShadow";
import { LOCAL_DATA_PAGES, LOCAL_DATA_SHADOW, localDataEnabledFor, localDataPageOn } from "@/lib/powersync/config";
import { israelDateKey } from "@/lib/timezone";
import LocalTasksBoard from "./LocalTasksBoard";
import TasksPageClient from "./TasksPageClient";
import { loadTaskPickerOptions, loadTasksBoard } from "./loadTasks";

export const revalidate = 30;

export default async function TasksPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; priority?: string; domain?: string; linked_id?: string; scope?: string; data?: string }>;
}) {
  const params = (await searchParams) ?? {};

  const q = typeof params.q === "string" ? params.q.trim() : "";
  const filterPriority = typeof params.priority === "string" ? params.priority.trim() : "";
  const filterDomain = typeof params.domain === "string" ? params.domain.trim() : "";
  const filterLinkedId = typeof params.linked_id === "string" ? params.linked_id.trim() : "";

  // The pickers' lists (and the users' colours) don't depend on who's asking,
  // so they go out alongside the "who's asking" check instead of after it —
  // under the caller's own RLS whatever their role; a caller without access is
  // still redirected below before anything is rendered. With the device
  // version on (LOCAL_DATA_PAGES.tasks) the device works them out itself, so
  // they wait for the check and go out only for people without a device copy.
  const supabase = await createSupabaseServerClient();
  const profilePromise = requireProfile();
  const earlyOptionsPromise = LOCAL_DATA_PAGES.tasks ? null : loadTaskPickerOptions(supabase);
  earlyOptionsPromise?.catch(() => {});

  const { profile } = await profilePromise;
  if (!isStaffRole(profile.role) && !hasSectionAccess(profile.role, profile.section_access, "tasks")) {
    redirect("/no-access");
  }
  const canSeeAll = profile.role === "admin" || profile.role === "office";
  // Everyone defaults to their own tasks ("mine" = assigned / member / creator).
  // Admin/office can opt into "all"; workers are always restricted (re-enforced
  // in the loader).
  const filterScope: "mine" | "all" = !canSeeAll ? "mine" : params.scope === "all" ? "all" : "mine";

  const filters = {
    q,
    priority: filterPriority,
    domain: filterDomain,
    linkedId: filterLinkedId,
    scope: filterScope,
  };

  // The device version: the board and its pickers are worked out from this
  // person's on-device copy (LocalTasksBoard), so the server reads nothing for
  // them. ?data=server is the way back when the copy can't serve it.
  const localMode = localDataPageOn("tasks", profile) && params.data !== "server";
  if (localMode) {
    return (
      <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
        <div className="space-y-4">
          <LocalTasksBoard
            viewer={{ userId: profile.id, role: profile.role ?? "", locale: profile.locale }}
            filters={filters}
            canSeeAll={canSeeAll}
          />
        </div>
      </AppShell>
    );
  }

  const [boardResult, options] = await Promise.all([
    loadTasksBoard(supabase, { filters, userId: profile.id, canSeeAll, locale: profile.locale }),
    earlyOptionsPromise ?? loadTaskPickerOptions(supabase),
  ]);

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <div className="space-y-4">
        {/* The tab bar is rendered by TasksPageClient on this page — the board's
            search / filters / + ride the END of that same row on desktop, and
            they're client-owned. Phones get no tab bar at all: "משימות קבועות"
            is a button in the header strip there (the recurring page keeps its
            tabs, so there's always a way back). */}
        {boardResult.error ? (
          <div className="text-destructive text-sm">
            {t(commonDict, profile.locale, "error")}: {boardResult.error}
          </div>
        ) : (
          <TasksPageClient
            tasks={boardResult.items}
            projects={options.projects}
            properties={options.properties}
            customers={options.customers}
            users={options.users}
            canSeeAll={canSeeAll}
            currentUserId={profile.id}
            locale={profile.locale}
            initialFilters={{ q, priority: filterPriority, domain: filterDomain, linkedId: filterLinkedId, scope: filterScope }}
          />
        )}
        {/* The device-copy shadow check of the board and its pickers
            (lib/powersync/dashboard-shadow.ts) — the same lists as above, so
            they travel to the browser once. Not for Arabic readers: their
            board translates task names on the server as it reads them, which
            the device doesn't. */}
        {!boardResult.error && profile.locale !== "ar" && LOCAL_DATA_SHADOW.tasks && localDataEnabledFor(profile.role) ? (
          <DashboardLocalShadow
            snapshot={{
              renderedAt: new Date(boardResult.loadedAt).toISOString(),
              userId: profile.id,
              role: profile.role ?? "",
              locale: profile.locale,
              todayIso: israelDateKey(),
              cards: { tasksBoard: { filters, items: boardResult.items, options } },
            }}
          />
        ) : null}
      </div>
    </AppShell>
  );
}

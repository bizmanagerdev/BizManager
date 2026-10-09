"use client";

import { useSearchParams } from "next/navigation";
import { AdaptiveGrid, AdaptiveStack, PageStack } from "@/components/layout/page-layout";
import { CountSkeleton, FieldSkeleton, TableSkeleton, TextLineSkeleton } from "@/components/layout/loading-skeletons";
import { PageHeaderToolbarSkeleton } from "@/components/layout/PageHeaderToolbarSkeleton";
import { DocumentIcon, ProjectIcon, SuccessIcon } from "@/components/ui/icons";
import { ResponsiveDataView } from "@/components/ui/responsive-data-view";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { parseProjectsView } from "@/app/(app)/projects/projectsFilters";

// The projects list's placeholder, from ProjectsClient's own pieces: the
// underline tabs (הצעות / פרויקטים / סגורים — the open one from the address),
// the md+ toolbar (search, status, sort) and the count line, then the table
// from xl and the swipe cards below it. Shown while the page streams
// (loading.tsx), while the device version works the list out
// (LocalProjectsPage) and while the list's code loads (the dynamic()
// fallbacks).

const COLUMNS = ["פרויקט", "סטטוס", "תאריך התחלה", "תשלום", "לקוח", "מחיר / רווח", "משימות פתוחות", "מסמכים", "פעולות"];

function Triggers({ className }: { className?: string }) {
  return (
    <>
      <TabsTrigger value="quotes" className={className}>
        <DocumentIcon className="h-4 w-4" />
        הצעות
        <CountSkeleton />
      </TabsTrigger>
      <TabsTrigger value="projects" className={className}>
        <ProjectIcon className="h-4 w-4" />
        פרויקטים
        <CountSkeleton />
      </TabsTrigger>
      <TabsTrigger value="closed" className={className}>
        <SuccessIcon className="h-4 w-4" />
        סגורים
        <CountSkeleton />
      </TabsTrigger>
    </>
  );
}

/** The phone strip's search and filter button, as the list puts them there. */
export function ProjectsStripSkeleton() {
  return (
    <PageHeaderToolbarSkeleton>
      <Skeleton className="h-10 w-full rounded-xl" />
      <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
    </PageHeaderToolbarSkeleton>
  );
}

export default function ProjectsListSkeleton() {
  const view = parseProjectsView(useSearchParams()?.get("view"));
  return (
    <PageStack aria-busy="true">
      <Tabs value={view}>
        <div className="hidden md:block">
          <TabsList variant="underline" className="justify-start">
            <Triggers />
          </TabsList>
        </div>
        <TabsList variant="underline" className="justify-start md:hidden">
          <Triggers className="!text-sm" />
        </TabsList>
      </Tabs>

      {/* The phone's filter panel (closed) — its wrapper still takes its gap. */}
      <div>
        <div className="space-y-3 md:hidden" />
      </div>

      <AdaptiveStack
        variant="toolbar"
        className="hidden min-w-0 md:flex md:flex-col md:gap-4 xl:flex-row xl:items-end xl:justify-between xl:gap-6"
      >
        <AdaptiveGrid variant="projectsToolbarControls" className="min-w-0 lg:grid-cols-4 xl:flex-1">
          <FieldSkeleton label="חיפוש" flexLabel className="lg:col-span-2" />
          <FieldSkeleton label="סטטוס" />
          <FieldSkeleton label="מיון לפי" />
        </AdaptiveGrid>
      </AdaptiveStack>

      <TextLineSkeleton className="hidden text-sm md:block" />

      <div>
        <ResponsiveDataView
          breakpoint="xl"
          desktop={<TableSkeleton headers={COLUMNS} rows={8} rowClassName="h-[8.25rem]" />}
          mobile={
            <div className="grid gap-2.5">
              <p className="px-1 text-[11px] text-muted-foreground">החלק כרטיס ימינה לפעולות · הקש לפתיחה</p>
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="relative min-w-0 overflow-hidden rounded-2xl border border-border/70 bg-background shadow-sm">
                  <div className="space-y-3 p-4">
                    <div className="flex gap-1.5">
                      <Skeleton className="h-5 w-16 rounded-full" />
                      <Skeleton className="h-5 w-14 rounded-full" />
                    </div>
                    <div className="space-y-1.5">
                      <Skeleton className="h-5 w-44" />
                      <Skeleton className="h-3 w-32" />
                    </div>
                    <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-2.5">
                      {[0, 1, 2].map((j) => (
                        <div key={j} className="space-y-1">
                          <Skeleton className="h-2.5 w-8" />
                          <Skeleton className="h-4 w-14" />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          }
        />
      </div>
    </PageStack>
  );
}

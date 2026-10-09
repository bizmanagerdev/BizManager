"use client";

import type { ReactNode } from "react";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { ChartIcon, ChecklistIcon, ClipboardIcon, DeliveryIcon, DocumentIcon, HistoryIcon, PaymentIcon, UserIcon } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { StatActionCard } from "@/components/ui/stat-action-card";

// A project page before its data: the page's own frame (ProjectPageView +
// ProjectTabsClient) with blanks where the figures will be — on a phone the
// status / type / dates chips, on a desktop the heading line; then the head
// row (the job's card, the customer, the money — on a phone customer first,
// and the status card after them) and the two columns: the movements, tasks
// and reminders, and beside them (under them on a phone) the status card and
// the money summary, the documents and the history. The cards are the page's
// own (StatActionCard, CollapsibleSection) with their names. The plain
// loading screen, the preview's body (ProjectPagePreview), the page's
// code-loading fallback and its first client render (ClientOnly).

function Line({ className = "w-16" }: { className?: string }) {
  return <Skeleton className={`h-3 ${className}`} />;
}

// A card's value line (text-lg, leading-snug), blank.
const VALUE = (
  <div className="text-lg leading-snug">
    <Skeleton className="inline-block h-4 w-24 align-middle" />
  </div>
);

const ACTION = <Skeleton className="h-9 w-full" />;

function rows(labels: string[]) {
  return labels.map((label) => ({ label, value: <Line /> }));
}

/** The phone's chips row (ProjectMobileHeader): status and type, the dates. */
export function ProjectMobileHeaderSkeleton() {
  return (
    <div className="md:hidden">
      <div className="-mx-3 -mt-4 flex flex-nowrap items-center justify-between gap-2 px-3 pb-0 pt-3">
        <div className="flex shrink-0 items-center gap-1.5">
          <Skeleton className="h-[1.4rem] w-14 rounded-full" />
          <Skeleton className="h-[1.4rem] w-12 rounded-full" />
        </div>
        <Skeleton className="h-3.5 w-28" />
      </div>
    </div>
  );
}

/** The desktop heading line (ProjectPageHeading): the breadcrumb, the name, the actions. */
function ProjectHeadingSkeleton() {
  return (
    <div className="hidden flex-col gap-2 lg:flex">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex h-4 items-center gap-1.5">
            <Line className="w-14" />
            <Line className="w-28" />
          </div>
          <div className="flex h-[1.75rem] items-center gap-2">
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-5 w-12 rounded-full" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-9 w-20" />
          ))}
        </div>
      </div>
    </div>
  );
}

const STATUS_CARD = (
  <StatActionCard
    icon={<ClipboardIcon className="h-5 w-5" />}
    label="סטטוס הפרויקט"
    value={VALUE}
    details={rows(["תאריכים", "מנהל פרויקט", "משימות"])}
  />
);

const SUMMARY_SECTION = (
  <section className="rounded-3xl border border-border/70 bg-card/80 p-4 shadow-sm">
    <div className="flex items-center gap-2 text-sm font-semibold">
      <ChartIcon className="h-4 w-4 text-primary" />
      סיכום כספי
    </div>
    <div className="mt-3 divide-y">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex h-[2.25rem] items-center justify-between gap-3">
          <Line className="w-24" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  </section>
);

/** Everything under the heading (ProjectTabsClient's own layout). */
export function ProjectBodySkeleton() {
  return (
    <>
      <div className="mb-3 grid grid-cols-1 gap-3 lg:grid-cols-3 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div className="order-2 lg:order-none">
          {/* The job's card: its name (הובלה / פרטי העבודה / הערות) isn't known yet. */}
          <div className="relative flex h-full flex-col gap-2.5 rounded-3xl border border-border/70 bg-card/80 p-3.5 shadow-sm">
            <div className="flex items-start gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <DeliveryIcon className="h-5 w-5" />
              </div>
              <div className="min-w-0 space-y-1.5 pt-0.5">
                <Line className="w-12" />
                <Skeleton className="h-4 w-40" />
              </div>
            </div>
            <div className="space-y-3 border-t border-border/50 pt-2">
              {/* The route's stops — a phone's rows; a desktop puts the route in the headline. */}
              {[0, 1].map((i) => (
                <div key={i} className="flex items-start gap-2 lg:hidden">
                  <Skeleton className="h-6 w-6 shrink-0 rounded-lg" />
                  <div className="space-y-1.5">
                    <Line className="w-10" />
                    <Skeleton className="h-4 w-40" />
                  </div>
                </div>
              ))}
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          </div>
        </div>
        <div className="order-1 lg:order-none">
          <StatActionCard icon={<UserIcon className="h-5 w-5" />} label="לקוח" value={VALUE} details={rows(["טלפון", "כתובת"])} action={ACTION} />
        </div>
        <div className="order-4 lg:hidden">{STATUS_CARD}</div>
        <div className="order-3 lg:order-none">
          <StatActionCard
            icon={<PaymentIcon className="h-5 w-5" />}
            label="תשלום"
            value={VALUE}
            details={rows(["נגבה", "תשלומים", "תנאי תשלום"])}
            action={ACTION}
          />
        </div>
      </div>

      <div className="flex flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_calc((100%_-_1.5rem)/3)] lg:items-start lg:gap-3 xl:grid-cols-[minmax(0,1fr)_calc((100%_-_1.5rem)/3.6)]">
        <div className="order-1 min-w-0 space-y-3 lg:order-none">
          <div className="lg:hidden">{SUMMARY_SECTION}</div>
          <CollapsibleSection collapsible={false} defaultOpen title="תנועות">
            <div className="space-y-1">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex h-10 items-center justify-between gap-3">
                  <div className="space-y-1.5">
                    <Skeleton className="h-4 w-32" />
                    <Line className="w-20" />
                  </div>
                  <Skeleton className="h-4 w-16" />
                </div>
              ))}
            </div>
          </CollapsibleSection>
          <CollapsibleSection title="משימות" icon={<ChecklistIcon className="h-4 w-4 text-primary" />}>
            {null}
          </CollapsibleSection>
          <CollapsibleSection title="תזכורות">{null}</CollapsibleSection>
        </div>
        <aside className="order-2 mt-3 space-y-3 lg:order-none lg:mt-0">
          <div className="hidden lg:block">{STATUS_CARD}</div>
          <div className="hidden lg:block">{SUMMARY_SECTION}</div>
          <CollapsibleSection title="מסמכים" icon={<DocumentIcon className="h-4 w-4 text-primary" />}>
            {null}
          </CollapsibleSection>
          <CollapsibleSection defaultOpen title="היסטוריית פעילות" icon={<HistoryIcon className="h-4 w-4 text-primary" />}>
            <div className="space-y-3">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="space-y-1.5">
                  <Skeleton className="h-4 w-3/4" />
                  <Line className="w-24" />
                </div>
              ))}
            </div>
          </CollapsibleSection>
        </aside>
      </div>
    </>
  );
}

export default function ProjectPageSkeleton({
  header,
  routeLoading = false,
}: {
  /** The phone chips and the desktop heading when the project is known; placeholders otherwise. */
  header?: ReactNode;
  /** Marks this as the route's loading screen for the top progress bar. */
  routeLoading?: boolean;
}) {
  return (
    <div className="space-y-3 md:space-y-5" data-route-loading={routeLoading ? "true" : undefined} aria-busy="true">
      {header ?? (
        <>
          <ProjectMobileHeaderSkeleton />
          <ProjectHeadingSkeleton />
        </>
      )}
      <ProjectBodySkeleton />
    </div>
  );
}

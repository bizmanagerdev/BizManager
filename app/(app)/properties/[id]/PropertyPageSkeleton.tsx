import { PageStack } from "@/components/layout/page-layout";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { StatActionCard } from "@/components/ui/stat-action-card";
import { SECTION_ICON_CLASS } from "@/components/ui/section-card";
import { BuildingIcon, ChartIcon, DocumentIcon, InfoIcon, PaymentIcon, RecurringIcon, TaskIcon, UserIcon } from "@/components/ui/icons";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { TopBarHeading } from "@/components/layout/TopBarHeading";

// A property's page before its data, in the page's own shape (owner,
// 2026-10-20: one details page like a project's): the heading, the head row
// (נכס · שוכר · שכירות החודש), and the two columns — the money card with its
// two tabs, and beside it the money summary, the recurring costs, the tasks,
// the files and the details (grouped so, 2026-10-21).
// The cards are the page's own (StatActionCard, CollapsibleSection) with their
// names, so nothing moves when the figures arrive. The plain loading screen,
// the properties list's on the way in from outside /properties
// (PropertiesLoadingBody), and the fallback while PropertyDetailClient's code
// loads.

function Line({ className = "w-16" }: { className?: string }) {
  return <Skeleton className={`h-3 ${className}`} />;
}

const VALUE = (
  <div className="text-lg leading-snug">
    <Skeleton className="inline-block h-4 w-28 align-middle" />
  </div>
);

const ACTION = <Skeleton className="h-9 w-full" />;

function rows(labels: string[]) {
  return labels.map((label) => ({ label, value: <Line /> }));
}

function Heading() {
  const buttons = (
    <div className="flex items-center gap-1.5" aria-hidden>
      <Skeleton className="h-9 w-9 rounded-xl" />
      <Skeleton className="h-9 w-9 rounded-xl" />
    </div>
  );
  return (
    <>
      {/* On a computer, in the top bar (PropertyPageHeading). */}
      <TopBarHeading section="נכסים" href="/properties" title={<Skeleton className="h-5 w-44" />} actions={buttons} />
      {/* On the phone, one line: נכסים › its name. */}
      <div className="flex items-center justify-between gap-3 lg:hidden">
        <div className="flex h-[1.75rem] min-w-0 items-center gap-1.5">
          <Line className="w-10" />
          <Skeleton className="h-5 w-44" />
        </div>
        {buttons}
      </div>
    </>
  );
}

function TableRows() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-10 w-full" />
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex h-12 items-center justify-between gap-3 border-b border-border/60">
          <Line className="w-14" />
          <Skeleton className="h-4 w-36" />
          <Line className="w-12" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

/** The whole page under the app's frame (PropertyDetailClient's own layout). */
export function PropertyDetailBodySkeleton() {
  return (
    <div className="space-y-3 @container md:space-y-5" aria-hidden>
      <Heading />
      <div className="grid grid-cols-1 gap-3 lg:@[31rem]:grid-cols-3">
        <StatActionCard icon={<BuildingIcon className="h-5 w-5" />} label="נכס" value={VALUE}>
          {/* Its details, and its photo beside them (PropertyPhotoBanner's size). */}
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1 space-y-1">
              <Line />
              <Line />
            </div>
            <Skeleton className="min-h-20 w-24 shrink-0 self-stretch rounded-xl" />
          </div>
        </StatActionCard>
        <StatActionCard
          icon={<UserIcon className="h-5 w-5" />}
          label="שוכר"
          value={VALUE}
          details={rows(["שכר דירה", "תקופה"])}
          action={ACTION}
        />
        <StatActionCard
          icon={<PaymentIcon className="h-5 w-5" />}
          label="שכירות החודש"
          value={VALUE}
          details={rows(["נגבה השנה", "תשלום אחרון"])}
          // "קביעת תשלומים מראש" above its רישום תשלום.
          action={
            <div className="space-y-1.5">
              {ACTION}
              {ACTION}
            </div>
          }
        />
      </div>
      {/* On a phone one list, the money summary first — as the page. */}
      <div className="flex flex-col gap-3 lg:@[31rem]:grid lg:@[31rem]:grid-cols-[minmax(0,1fr)_calc((100%_-_1.5rem)/3)] lg:@[31rem]:items-start">
        <div className="contents lg:@[31rem]:block lg:@[31rem]:min-w-0 lg:@[31rem]:space-y-3">
          <CollapsibleSection
            collapsible={false}
            title="תנועות"
            action={
              <div className="flex items-center gap-1.5">
                <Skeleton className="h-9 w-20" />
                <Skeleton className="h-9 w-20" />
              </div>
            }
          >
            {/* The page's own tab row, so its height is exact. */}
            <Tabs value="done" dir="rtl">
              <TabsList variant="underline" className="mb-3">
                <TabsTrigger value="done">שבוצעו</TabsTrigger>
                <TabsTrigger value="expected">צפויים</TabsTrigger>
              </TabsList>
            </Tabs>
            <Skeleton className="mb-2 h-10 w-full" />
            <TableRows />
          </CollapsibleSection>
          {/* Under the movements, as the page (2026-10-22). */}
          <CollapsibleSection collapsible={false} title="משימות" icon={<TaskIcon className={SECTION_ICON_CLASS} />}>
            <Skeleton className="h-10 w-full" />
          </CollapsibleSection>
        </div>
        <div className="contents lg:@[31rem]:block lg:@[31rem]:min-w-0 lg:@[31rem]:space-y-3">
          <div className="order-first">
            <CollapsibleSection collapsible={false} title="סיכום כספי" icon={<ChartIcon className={SECTION_ICON_CLASS} />}>
              <div className="divide-y">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex h-[2.25rem] items-center justify-between gap-3">
                    <Line className="w-24" />
                    <Skeleton className="h-4 w-16" />
                  </div>
                ))}
              </div>
              <Skeleton className="mx-auto mt-3 h-36 w-36 rounded-full" />
            </CollapsibleSection>
          </div>
          <CollapsibleSection collapsible={false} title="הוצאות קבועות" icon={<RecurringIcon className={SECTION_ICON_CLASS} />}>
            <Skeleton className="h-10 w-full" />
          </CollapsibleSection>
          <CollapsibleSection collapsible={false} title="מסמכים ותמונות" icon={<DocumentIcon className={SECTION_ICON_CLASS} />}>
            <Skeleton className="h-16 w-full" />
          </CollapsibleSection>
          <CollapsibleSection collapsible={false} title="פרטים" icon={<InfoIcon className={SECTION_ICON_CLASS} />}>
            <Skeleton className="h-28 w-full" />
          </CollapsibleSection>
        </div>
      </div>
    </div>
  );
}

export default function PropertyPageSkeleton({ routeLoading = false }: { routeLoading?: boolean }) {
  return (
    <PageStack data-route-loading={routeLoading ? "true" : undefined} aria-busy="true">
      <PropertyDetailBodySkeleton />
    </PageStack>
  );
}

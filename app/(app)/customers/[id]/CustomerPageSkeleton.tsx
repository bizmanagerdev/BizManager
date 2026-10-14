"use client";

import type { ReactNode } from "react";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import {
  CalendarCheckIcon,
  DocumentIcon,
  NoteIcon,
  OrderIcon,
  PaymentIcon,
  PhoneCallIcon,
  ProjectIcon,
  ReceiptIcon,
  TaskIcon,
  UserIcon,
} from "@/components/ui/icons";
import { SECTION_ICON_CLASS } from "@/components/ui/section-card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatActionCard } from "@/components/ui/stat-action-card";
import { HeaderActionsPlaceholder } from "@/components/layout/HeaderActionsMenu";
import { useSetPageTitle } from "@/components/layout/page-title-context";
import CustomerPageHeading from "@/app/(app)/customers/[id]/CustomerPageHeading";
import { CountSkeleton, InlineSkeleton, RowsSkeleton } from "@/app/(app)/customers/[id]/customerSectionUi";

// A customer's page before its data: the page's own frame (CustomerPageView)
// with blanks where the figures will be — the top bar's "לקוח" and its ⋮, on a
// computer the heading line; the לקוח and חוב פתוח cards at their real
// heights; then every section at its header's real height, in the page's
// order, the orders open as they usually are. The cards and sections are the
// page's own (StatActionCard, CollapsibleSection) with their names, so when
// the page lands nothing moves — only the blanks fill in. The rented
// properties and the history exist only for some customers and viewers, so
// they aren't guessed at. The plain loading screen, and the customers list's
// on the way in (CustomersLoadingBody).

// The page's ⋮ (CustomerHeaderMenu's), held in place until it arrives — one
// element, so the bar's title isn't re-set on every render.
const HEADER_MENU_PLACEHOLDER = <HeaderActionsPlaceholder />;

function Line({ className = "w-16" }: { className?: string }) {
  return <InlineSkeleton className={`h-3 ${className}`} />;
}

// A card's value line (text-lg, leading-snug), blank.
const VALUE = (
  <div className="text-lg leading-snug">
    <Skeleton className="inline-block h-4 w-28 align-middle" />
  </div>
);

const ACTION = <Skeleton className="h-9 w-full" />;

// A section's "+" (AddActionButton: h-8, a glyph and a word).
const ADD = <Skeleton className="h-8 w-[4.5rem] rounded-xl" />;

function rows(labels: string[]) {
  return labels.map((label) => ({ label, value: <Line /> }));
}

/** A section folded to its header line — the count and the "+" still blank. */
function Folded({ title, icon, add = true }: { title: string; icon: ReactNode; add?: boolean }) {
  return (
    <CollapsibleSection title={title} icon={icon} summary={<CountSkeleton />} action={add ? ADD : undefined}>
      {null}
    </CollapsibleSection>
  );
}

export default function CustomerPageSkeleton({ routeLoading = false }: { routeLoading?: boolean }) {
  // The phone's top bar says what this is, beside the ⋮ the page will put there.
  useSetPageTitle("לקוח", undefined, HEADER_MENU_PLACEHOLDER);

  return (
    <div className="space-y-3 md:space-y-5" data-route-loading={routeLoading ? "true" : undefined} aria-busy="true">
      <CustomerPageHeading
        name={<Skeleton className="inline-block h-5 w-40 align-middle" />}
        actions={
          <div className="flex items-center gap-2" aria-hidden>
            <Skeleton className="h-9 w-9" />
            <Skeleton className="h-9 w-9" />
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2" aria-hidden>
        <StatActionCard
          icon={<UserIcon className="h-5 w-5" />}
          label="לקוח"
          value={VALUE}
          details={rows(["טלפון", "אימייל", "כתובת"])}
          action={ACTION}
        >
          {/* The arrival details' box (CustomerDeliveryDetails). */}
          <div className="space-y-1.5 rounded-xl border border-border/70 bg-background/70 p-2.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">הוראות הגעה</span>
              <Skeleton className="h-9 w-9" />
            </div>
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-3 w-48 max-w-full" />
          </div>
        </StatActionCard>
        <StatActionCard
          icon={<PaymentIcon className="h-5 w-5" />}
          label="חוב פתוח"
          value={VALUE}
          details={rows(["נגבה", "פעילות אחרונה"])}
          action={ACTION}
        >
          <Skeleton className="h-1.5 w-full rounded-full" />
        </StatActionCard>
      </div>

      <div className="flex flex-col gap-3 lg:grid lg:grid-cols-2 lg:items-start" aria-hidden>
        <div className="min-w-0 space-y-3">
          <CollapsibleSection
            defaultOpen
            title="הזמנות"
            icon={<OrderIcon className={SECTION_ICON_CLASS} />}
            summary={<CountSkeleton />}
            action={ADD}
          >
            <RowsSkeleton count={3} />
          </CollapsibleSection>
          <Folded title="פרויקטים" icon={<ProjectIcon className={SECTION_ICON_CLASS} />} />
          <Folded title="גבייה ושיחות" icon={<PhoneCallIcon className={SECTION_ICON_CLASS} />} />
          <Folded title="משימות" icon={<TaskIcon className={SECTION_ICON_CLASS} />} />
          <Folded title="תשלומים אחרונים" icon={<PaymentIcon className={SECTION_ICON_CLASS} />} add={false} />
          <Folded title="הבטחות תשלום" icon={<CalendarCheckIcon className={SECTION_ICON_CLASS} />} />
        </div>
        <div className="min-w-0 space-y-3">
          <Folded title="אנשי קשר וסניפים" icon={<UserIcon className={SECTION_ICON_CLASS} />} />
          <Folded title="מסמכים" icon={<DocumentIcon className={SECTION_ICON_CLASS} />} />
          <Folded title="הערות" icon={<NoteIcon className={SECTION_ICON_CLASS} />} add={false} />
          <Folded title="Morning" icon={<ReceiptIcon className={SECTION_ICON_CLASS} />} add={false} />
        </div>
      </div>
    </div>
  );
}

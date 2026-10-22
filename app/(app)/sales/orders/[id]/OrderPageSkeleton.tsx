import type { ReactNode } from "react";
import { DeliveryIcon, DocumentIcon, OrderIcon, PaymentIcon, UserIcon } from "@/components/ui/icons";
import { SECTION_ICON_CLASS, SectionCard } from "@/components/ui/section-card";
import { StatActionCard } from "@/components/ui/stat-action-card";
import { Skeleton } from "@/components/ui/skeleton";
import { TopBarHeading } from "@/components/layout/TopBarHeading";

// An order page before its data: the page's own frame (OrderPageView) — the
// desktop heading line, the status / payment / invoice cards (on a phone the
// customer card between the first two), then the main column with the items
// and the side column with the customer and the delivery photos — its cards
// the page's own (StatActionCard, SectionCard) with their icons and names,
// placeholders where the figures will be. So the page lands into its own
// shape: nothing moves, the blanks fill in. The plain loading screen, and —
// with the order's heading — the preview (OrderPagePreview).

function Line({ className = "w-16" }: { className?: string }) {
  return <Skeleton className={`h-3 ${className}`} />;
}

// The card's value line (text-lg, leading-snug), blank.
const VALUE = (
  <div className="text-lg leading-snug">
    <Skeleton className="inline-block h-4 w-24 align-middle" />
  </div>
);

function detailRows(labels: string[]) {
  return labels.map((label) => ({ label, value: <Line /> }));
}

/** The customer card (CustomerContactCard) with its rows still blank. */
function ContactCardSkeleton() {
  return (
    <StatActionCard
      icon={<UserIcon className="h-5 w-5" />}
      label="לקוח"
      value={VALUE}
      subtitles={[<Line key="sub" className="w-32" />]}
      details={detailRows(["טלפון", "אימייל", "כתובת"])}
      action={<Skeleton className="h-9 w-full" />}
    />
  );
}

export default function OrderPageSkeleton({
  heading,
  routeLoading = false,
}: {
  /** The desktop heading (OrderPageHeading) when the order is known; a placeholder line otherwise. */
  heading?: ReactNode;
  /** Marks this as the route's loading screen for the top progress bar. */
  routeLoading?: boolean;
}) {
  return (
    <div className="space-y-3" data-route-loading={routeLoading ? "true" : undefined} aria-busy="true">
      {/* The desktop heading — in the top bar (OrderPageHeading): the order's when known, a placeholder otherwise. */}
      {heading ?? (
        <TopBarHeading
          section="מכירות"
          href="/sales"
          title={<Skeleton className="h-5 w-32" />}
          actions={
            <div className="flex items-center gap-2" aria-hidden>
              <Skeleton className="h-9 w-9" />
              <Skeleton className="h-9 w-9" />
            </div>
          }
        />
      )}
      <section className="space-y-3" aria-hidden>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <StatActionCard
            icon={<DeliveryIcon className="h-5 w-5" />}
            label="סטטוס הזמנה"
            value={VALUE}
            details={detailRows(["תאריך הזמנה", "פריטים", 'הוזן ע"י'])}
            action={<Skeleton className="h-9 w-full" />}
          />
          <div className="lg:hidden">
            <ContactCardSkeleton />
          </div>
          <StatActionCard
            icon={<PaymentIcon className="h-5 w-5" />}
            label="תשלום"
            value={VALUE}
            details={detailRows(["נגבה", "תשלומים", "תנאי תשלום"])}
            action={<Skeleton className="h-9 w-full" />}
          />
          <StatActionCard icon={<DocumentIcon className="h-5 w-5" />} label="חשבונית" value={VALUE} />
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3 lg:items-start">
          <div className="space-y-3 lg:order-2">
            <div className="hidden lg:block">
              <ContactCardSkeleton />
            </div>
            {/* Stand-ins for SectionCards: the Card's corner (rounded-card),
                since SectionCard became the project page's box. */}
            <div className="h-32 animate-pulse rounded-card border border-border/70 bg-muted/40" />
          </div>
          <div className="space-y-3 lg:order-1 lg:col-span-2">
            {/* The count is a SectionCount: a grey pill one number wide. */}
            <SectionCard icon={<OrderIcon className={SECTION_ICON_CLASS} />} title="פריטים" aside={<Skeleton className="h-5 w-7 rounded-full" />}>
              <div className="divide-y divide-border/60">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex items-center justify-between gap-3 py-3">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-4 w-14" />
                  </div>
                ))}
              </div>
              <Skeleton className="h-11 w-full rounded-xl bg-muted/30" />
            </SectionCard>
            <div className="h-24 animate-pulse rounded-card border border-border/70 bg-muted/40" />
            <div className="h-24 animate-pulse rounded-card border border-border/70 bg-muted/40" />
          </div>
        </div>
      </section>
    </div>
  );
}

import type { ReactNode } from "react";
import { ChevronLeftIcon, ReceiptIcon, UserIcon } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { AdaptiveGrid } from "@/components/layout/page-layout";
import { TextLineSkeleton } from "@/components/layout/loading-skeletons";
import { ButtonSkeleton } from "@/app/(app)/financial/ButtonSkeleton";

// A loan's page before its data, from LoanDetailClient's own classes: the
// breadcrumb line (חובות › the counterparty, which is the page's h1) with the
// two badges and the documents / edit / delete buttons, then the two sections
// by their names — the loan's facts, and the repayments: the three boxes, the
// planned payments box, the paid history and the record button. Shown while
// the page streams (loading.tsx).

// SectionCard's shell (components/ui/section-card.tsx).
function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="scroll-mt-24 space-y-3 rounded-3xl border border-border/70 bg-card/80 p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-primary">{icon}</span>
          <h2 className="text-sm font-semibold">{title}</h2>
        </div>
      </div>
      {children}
    </section>
  );
}

// A repayment line (planned or paid): date and amount, its buttons.
function PaymentRow({ pay = false }: { pay?: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background px-3 py-2 text-sm">
      <TextLineSkeleton barClassName="w-40" />
      <div className="flex shrink-0 items-center gap-2">
        {pay ? <ButtonSkeleton label="שולם" size="sm" icon /> : null}
        <Skeleton className="h-9 w-9 rounded-xl" />
        {pay ? null : <Skeleton className="h-9 w-9 rounded-xl" />}
        <Skeleton className="h-9 w-9 rounded-xl" />
      </div>
    </div>
  );
}

export default function LoanDetailSkeleton() {
  return (
    <div className="space-y-3" dir="rtl" data-route-loading="true" aria-busy="true">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>חובות</span>
            <ChevronLeftIcon className="h-3.5 w-3.5" />
            <TextLineSkeleton className="text-lg font-bold" barClassName="w-32" />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Skeleton className="h-6 w-24 rounded-full" />
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <ButtonSkeleton label="מסמכים" size="sm" icon />
          <Skeleton className="h-9 w-9 shrink-0 rounded-xl" />
          <Skeleton className="h-9 w-9 shrink-0 rounded-xl" />
        </div>
      </div>

      <Section icon={<UserIcon className="h-4 w-4" />} title="פרטי הלוואה">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="min-w-0">
              <TextLineSkeleton className="text-xs" barClassName="w-14" />
              <TextLineSkeleton className="text-sm font-medium" barClassName="w-24" />
            </div>
          ))}
        </div>
      </Section>

      <Section icon={<ReceiptIcon className="h-4 w-4" />} title="החזרים ותוכנית תשלומים">
        <div className="space-y-4">
          <AdaptiveGrid variant="customerStats">
            {["סכום ההלוואה", "נפרע (קרן)", "יתרה"].map((label) => (
              <div key={label} className="rounded-md border bg-background p-3">
                <div className="text-xs text-muted-foreground">{label}</div>
                <TextLineSkeleton className="mt-0.5 text-xl font-semibold" barClassName="w-24" />
              </div>
            ))}
          </AdaptiveGrid>
          <div className="space-y-3 rounded-md border bg-muted/20 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold">תשלומים לתשלום</div>
              <Skeleton className="h-9 w-9 rounded-xl" />
            </div>
            <div className="space-y-2">
              <PaymentRow pay />
              <PaymentRow pay />
              <PaymentRow pay />
            </div>
          </div>
          <div className="space-y-2">
            <div className="text-sm font-semibold">היסטוריית החזרים ששולמו</div>
            <PaymentRow />
            <PaymentRow />
          </div>
          <div className="flex justify-end">
            <ButtonSkeleton label="רישום החזר" size="sm" />
          </div>
        </div>
      </Section>
    </div>
  );
}

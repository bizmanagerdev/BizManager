"use client";

import Link from "next/link";
import { StepWizard } from "@/components/ui/step-wizard";
import { StepHeading } from "@/components/ui/option-row";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { UserIcon } from "@/components/ui/icons";
import { STEP_LABEL, type Step } from "./NewOrderClient.ui";

// The order form's page (NewOrderClient, standalone) before it arrives: the
// wizard itself — its step bar on top, its action bar fixed above the bottom
// nav on a phone — at its first step, "which customer": the heading, the
// existing / new toggle, the search and the customer rows, and (beside them
// from lg) the empty "pick a customer" panel. The new-order page's loading
// screen, the edit page's (under its heading) and the form's own code-loading
// fallback.

// A new order's steps (NewOrderClient's stepIds, its default payment terms).
const STEP_IDS: Step[] = ["customer", "items", "invoice", "collection", "paymentTerms", "dueDate", "payments", "orderDate", "orderStatus", "deliveryDate", "notes", "summary"];
const STEPS = STEP_IDS.map((id) => ({ n: id, label: STEP_LABEL[id] }));
const noop = () => {};
const never = () => false;

/** `cancelHref`: where the action bar's ביטול leads, as on the form (the sales page, or the order). */
export default function OrderFormSkeleton({ cancelHref = "/sales" }: { cancelHref?: string }) {
  return (
    <div className="space-y-4" aria-busy="true">
      <StepWizard
        variant="page"
        progressVariant="bar"
        steps={STEPS}
        current="customer"
        canClickStep={never}
        onStepClick={noop}
        onNext={noop}
        nextDisabled
        footerStart={
          <Button type="button" variant="secondary" asChild className="me-auto">
            <Link href={cancelHref}>ביטול</Link>
          </Button>
        }
      >
        <div className="space-y-4" aria-hidden>
          <StepHeading title="איזה לקוח?" />
          <div className="inline-flex rounded-2xl border border-border/60 bg-background/70 p-1 shadow-sm">
            <span className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm">לקוח קיים</span>
            <span className="rounded-xl px-4 py-2 text-sm font-medium text-muted-foreground">לקוח חדש</span>
          </div>
          <div className="space-y-4 lg:grid lg:grid-cols-2 lg:gap-4 lg:space-y-0">
            <div className="min-w-0 space-y-3">
              <Skeleton className="h-11 w-full rounded-xl" />
              {/* From lg the list is a 24rem scroll box, full with the first customers. */}
              <div className="space-y-2 pe-1 lg:h-[24rem] lg:overflow-hidden">
                {Array.from({ length: 7 }).map((_, i) => (
                  <div key={i} className="flex w-full items-start gap-3 rounded-2xl border border-border bg-background px-3 py-2.5">
                    <span className="mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 border-border" />
                    <span className="min-w-0 flex-1 space-y-1.5 py-0.5">
                      <Skeleton className="h-4 w-36" />
                      <Skeleton className="h-3 w-28" />
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="min-w-0">
              <div className="flex h-full min-h-[16rem] flex-col items-center justify-center gap-2 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <UserIcon className="h-6 w-6" />
                </span>
                <p className="text-sm font-medium text-foreground">בחרו לקוח מהרשימה</p>
                <p className="text-sm text-muted-foreground">פרטי הלקוח יוצגו כאן וניתן יהיה לערוך אותם.</p>
              </div>
            </div>
          </div>
        </div>
      </StepWizard>
    </div>
  );
}

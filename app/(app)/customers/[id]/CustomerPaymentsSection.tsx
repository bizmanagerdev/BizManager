"use client";

import { Suspense, use, type ReactNode } from "react";
import Link from "next/link";
import { PaymentIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { EmptyState } from "@/components/ui/empty-state";
import { MetaRow } from "@/components/ui/meta-row";
import { SECTION_ICON_CLASS, SectionCount } from "@/components/ui/section-card";
import { formatMoney } from "@/lib/money";
import { formatShortDate } from "@/lib/date";
import { paymentMethodLabel } from "@/lib/orders/paymentStatus";
import { CountSkeleton, RowsSkeleton, SECTION_IDS } from "@/app/(app)/customers/[id]/customerSectionUi";
import { OrderRef } from "@/app/(app)/customers/[id]/CustomerOrdersSection";
import type { CustomerPaymentRow, CustomerPaymentsResult } from "@/app/(app)/customers/[id]/customerPageModel";

// תשלומים אחרונים: the customer's payments — orders, projects and rent — newest
// first. They arrive after the page (every one of them, so the count is the
// real one); the section is folded until it's opened, so nothing moves when
// they do.

export const PAYMENTS_SHOWN = 10;

function PaymentsCount({ payments }: { payments: Promise<CustomerPaymentsResult> }) {
  return <SectionCount count={use(payments).payments.length} />;
}

function statusText(status: string) {
  if (status === "rejected") return { label: "נדחה", className: "text-destructive" };
  if (status === "pending") return { label: "צפוי", className: "text-primary" };
  return { label: "נגבה", className: "text-success-soft-foreground" };
}

function PaymentRowView({ payment }: { payment: CustomerPaymentRow }) {
  const status = statusText(payment.status);
  const source = payment.source;
  const body: ReactNode = (
    <>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{formatShortDate(payment.date, "—")}</span>
          <MetaRow
            className="text-xs text-muted-foreground"
            items={[
              payment.method ? paymentMethodLabel(payment.method) : null,
              payment.checkNumber ? (
                <>
                  צ׳ק <span dir="ltr">{payment.checkNumber}</span>
                </>
              ) : null,
            ]}
          />
        </div>
        <MetaRow
          className="mt-0.5 text-xs text-muted-foreground"
          items={[
            source?.type === "order" ? <OrderRef key="ref" orderId={source.id} /> : source?.label,
            payment.status === "pending" && payment.dueDate ? `לפירעון ${formatShortDate(payment.dueDate, "—")}` : null,
          ]}
        />
      </div>
      <div className="shrink-0 text-end">
        <div className="font-semibold tabular-nums">{formatMoney(payment.amount)}</div>
        <div className={`text-xs font-medium ${status.className}`}>{status.label}</div>
      </div>
    </>
  );
  const rowClass = "-mx-2 flex items-center justify-between gap-3 rounded-xl px-2 py-2.5 text-sm hover:bg-muted/20";
  if (!source) return <div className="flex items-center justify-between gap-3 py-2.5 text-sm">{body}</div>;
  const href =
    source.type === "order"
      ? `/sales/orders/${encodeURIComponent(source.id)}`
      : source.type === "project"
        ? `/projects/${encodeURIComponent(source.id)}`
        : `/properties/${encodeURIComponent(source.id)}`;
  return (
    <Link href={href} className={rowClass}>
      {body}
    </Link>
  );
}

function PaymentsList({
  payments,
  financialHref,
}: {
  payments: Promise<CustomerPaymentsResult>;
  financialHref: string;
}) {
  const result = use(payments);
  if (result.error) return <p className="text-sm text-destructive">{result.error}</p>;
  if (result.payments.length === 0) return <EmptyState dense>אין תשלומים ללקוח זה.</EmptyState>;
  return (
    <div className="space-y-3">
      <div className="divide-y divide-border/60">
        {result.payments.slice(0, PAYMENTS_SHOWN).map((payment, index) => (
          <PaymentRowView key={payment.id || `payment-${index}`} payment={payment} />
        ))}
      </div>
      <Button asChild size="sm" variant="outline" className="w-full">
        <Link href={financialHref}>לכל התנועות במידע הפיננסי</Link>
      </Button>
    </div>
  );
}

export default function CustomerPaymentsSection({
  customerId,
  customerName,
  payments,
}: {
  customerId: string;
  customerName: string;
  payments: Promise<CustomerPaymentsResult>;
}) {
  const financialHref = `/financial?customer_id=${encodeURIComponent(customerId)}&customer_name=${encodeURIComponent(customerName.trim())}`;
  return (
    <CollapsibleSection
      id={SECTION_IDS.payments}
      title="תשלומים אחרונים"
      icon={<PaymentIcon className={SECTION_ICON_CLASS} />}
      summary={
        <Suspense fallback={<CountSkeleton />}>
          <PaymentsCount payments={payments} />
        </Suspense>
      }
    >
      <Suspense fallback={<RowsSkeleton count={3} />}>
        <PaymentsList payments={payments} financialHref={financialHref} />
      </Suspense>
    </CollapsibleSection>
  );
}

"use client";

import Link from "next/link";
import { OrderIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { EmptyState } from "@/components/ui/empty-state";
import { MetaRow } from "@/components/ui/meta-row";
import { SECTION_ICON_CLASS, SectionCount } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatMoney } from "@/lib/money";
import { formatShortDate } from "@/lib/date";
import { AddActionButton, SECTION_IDS } from "@/app/(app)/customers/[id]/customerSectionUi";
import { paymentsHe, type CustomerOrderRow } from "@/app/(app)/customers/[id]/customerPageModel";

/** The newest orders on the page; the rest are a link away (the orders list, filtered to this customer). */
export const ORDERS_SHOWN = 10;

/** Short order reference, bidi-isolated so the # and hex don't scramble in RTL. */
export function OrderRef({ orderId }: { orderId: string }) {
  return (
    <>
      הזמנה <span dir="ltr">#{orderId.slice(0, 8)}</span>
    </>
  );
}

export default function CustomerOrdersSection({
  customerId,
  customerName,
  orders,
  error,
}: {
  customerId: string;
  customerName: string;
  orders: CustomerOrderRow[];
  error: string | null;
}) {
  const newOrderHref = `/sales/orders/new?customer_id=${encodeURIComponent(customerId)}`;
  const allOrdersHref = `/sales?customer_id=${encodeURIComponent(customerId)}&customer_name=${encodeURIComponent(customerName.trim())}`;

  return (
    <CollapsibleSection
      id={SECTION_IDS.orders}
      title="הזמנות"
      icon={<OrderIcon className={SECTION_ICON_CLASS} />}
      summary={<SectionCount count={orders.length} />}
      // What a customer's page is usually opened for: open when there are any.
      defaultOpen={orders.length > 0}
      action={<AddActionButton href={newOrderHref} label="הזמנה" ariaLabel="הזמנה חדשה ללקוח" />}
      contentClassName="space-y-3"
    >
      {error ? <p className="text-sm text-destructive">שגיאה בטעינת ההזמנות: {error}</p> : null}
      {orders.length === 0 ? (
        <EmptyState dense>אין הזמנות ללקוח זה.</EmptyState>
      ) : (
        <div className="divide-y divide-border/60">
          {orders.slice(0, ORDERS_SHOWN).map((order) => {
            const overpaid = order.total > 0 && order.collected > order.total + 0.009;
            return (
              <Link
                key={order.id}
                href={`/sales/orders/${encodeURIComponent(order.id)}`}
                className="-mx-2 flex items-center justify-between gap-3 rounded-xl px-2 py-2.5 text-sm hover:bg-muted/20"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{formatShortDate(order.date, "—")}</span>
                    {order.status ? <StatusBadge value={order.status} type="order" /> : null}
                  </div>
                  <MetaRow
                    className="mt-0.5 text-xs text-muted-foreground"
                    items={[
                      <OrderRef key="ref" orderId={order.id} />,
                      order.paymentCount > 0 ? paymentsHe(order.paymentCount) : null,
                      order.pending > 0.009 ? `צפוי לגבייה ${formatMoney(order.pending)}` : null,
                    ]}
                  />
                </div>
                <div className="shrink-0 text-end">
                  <div className="font-semibold tabular-nums">{formatMoney(order.total)}</div>
                  <div
                    className={`text-xs font-medium ${
                      overpaid || order.remaining > 0.009 ? "text-destructive" : "text-success-soft-foreground"
                    }`}
                  >
                    {overpaid ? "שולם יתר" : order.remaining > 0.009 ? `נותר ${formatMoney(order.remaining)}` : "שולם"}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
      {orders.length > ORDERS_SHOWN ? (
        <Button asChild size="sm" variant="outline" className="w-full">
          <Link href={allOrdersHref}>לכל ההזמנות ({orders.length})</Link>
        </Button>
      ) : null}
    </CollapsibleSection>
  );
}

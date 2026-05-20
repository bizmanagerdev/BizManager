"use client";

import Link from "next/link";
import { MapPin, Phone, Truck } from "lucide-react";
import OrderConfirmDialog from "@/app/sales/orders/OrderConfirmDialog";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatShortDate } from "@/lib/date";
import { getOrderStatusLabel } from "@/lib/ui/status-colors";

type DeliveryItem = {
  id: string;
  customerId: string;
  orderDate: string | null;
  status: string;
  totalAmount: number | null;
  notes: string | null;
  customerName: string;
  customerPhone: string | null;
  city: string;
  address: string;
};

type CustomerGroup = {
  customerName: string;
  customerPhone: string | null;
  address: string;
  orders: DeliveryItem[];
};

function formatCurrency(value: number | null) {
  if (value === null) return "-";
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 2,
  }).format(value);
}

function phoneHref(value: string | null) {
  if (!value) return null;
  const normalized = value.replace(/[^\d+]/g, "");
  return normalized ? `tel:${normalized}` : null;
}

export default function SalesDeliveriesQueue({
  deliveriesByCityAndCustomer,
}: {
  deliveriesByCityAndCustomer: ReadonlyArray<
    readonly [string, ReadonlyArray<readonly [string, CustomerGroup]>]
  >;
}) {
  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-border/60 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        בחרו לקוח, אשרו אספקה בשטח, ופתחו פרטים רק כשצריך.
      </div>

      {deliveriesByCityAndCustomer.map(([city, customerGroups]) => (
        <Card key={city} className="overflow-hidden">
          <CardContent className="space-y-3 p-3 sm:p-4">
            <div className="flex flex-col gap-2 border-b border-border/60 pb-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-sky-200 bg-sky-50 text-sky-700">
                  <Truck className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-base font-semibold">{city}</h3>
                  <div className="text-xs text-muted-foreground">מסך חלוקה לפי לקוח והזמנה</div>
                </div>
              </div>
              <span className="w-fit rounded-full border border-border/70 bg-background px-2.5 py-1 text-xs text-muted-foreground">
                {customerGroups.length} לקוחות •{" "}
                {customerGroups.reduce((sum, [, group]) => sum + group.orders.length, 0)} משלוחים
              </span>
            </div>

            <div className="space-y-2">
              {customerGroups.map(([customerKey, group]) => {
                const customerPhoneHref = phoneHref(group.customerPhone);

                return (
                  <div
                    key={customerKey}
                    className="rounded-lg border border-border/70 bg-background/80 px-2 py-1.5"
                  >
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                      <span className="text-sm font-semibold">{group.customerName}</span>
                      {group.customerPhone ? (
                        customerPhoneHref ? (
                          <a
                            href={customerPhoneHref}
                            className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground"
                          >
                            <Phone className="h-3 w-3" />
                            <span dir="ltr">{group.customerPhone}</span>
                          </a>
                        ) : (
                          <span className="inline-flex items-center gap-0.5 text-muted-foreground">
                            <Phone className="h-3 w-3" />
                            <span dir="ltr">{group.customerPhone}</span>
                          </span>
                        )
                      ) : null}
                      <span className="inline-flex items-center gap-0.5 text-muted-foreground">
                        <MapPin className="h-3 w-3" />
                        {group.address}
                      </span>
                      <span className="mr-auto text-muted-foreground">{group.orders.length} משלוחים</span>
                    </div>

                    <div className="mt-1 divide-y divide-border/50">
                      {group.orders.map((delivery) => (
                        <div
                          key={delivery.id}
                          title={delivery.notes ?? undefined}
                          className="flex items-center gap-2 py-1 text-xs hover:bg-muted/20"
                        >
                          <span className="font-medium">#{delivery.id.slice(0, 6)}</span>
                          <span className="text-muted-foreground">{formatShortDate(delivery.orderDate, "-")}</span>
                          <span className="font-medium">{formatCurrency(delivery.totalAmount)}</span>
                          <span className="truncate text-muted-foreground">{getOrderStatusLabel(delivery.status)}</span>
                          <div className="mr-auto flex shrink-0 gap-1">
                            <OrderConfirmDialog
                              orderId={delivery.id}
                              buttonLabel="אספקה"
                              buttonClassName="h-6 px-2 text-xs"
                            />
                            <Button asChild type="button" variant="secondary" size="sm" className="h-6 px-2 text-xs" onClick={() => emitNavigationStart()}>
                              <Link href={`/sales/orders/${delivery.id}`}>פרטים</Link>
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

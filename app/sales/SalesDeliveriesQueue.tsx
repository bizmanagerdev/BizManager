"use client";

import Link from "next/link";
import { CalendarDays, MapPin, Phone, Truck } from "lucide-react";
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

            <div className="space-y-3">
              {customerGroups.map(([customerKey, group]) => {
                const customerPhoneHref = phoneHref(group.customerPhone);

                return (
                  <div
                    key={customerKey}
                    className="rounded-2xl border border-border/70 bg-background/80 p-3 sm:p-4"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 space-y-2">
                        <div>
                          <div className="text-base font-semibold">{group.customerName}</div>
                          {group.customerPhone ? (
                            customerPhoneHref ? (
                              <a
                                href={customerPhoneHref}
                                className="mt-1 inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted/20 px-2.5 py-1 text-xs text-foreground hover:bg-muted/40"
                              >
                                <Phone className="h-3.5 w-3.5" />
                                <span dir="ltr">{group.customerPhone}</span>
                              </a>
                            ) : (
                              <div className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                                <Phone className="h-3.5 w-3.5" />
                                <span dir="ltr">{group.customerPhone}</span>
                              </div>
                            )
                          ) : (
                            <div className="mt-1 text-xs text-muted-foreground">טלפון: -</div>
                          )}
                        </div>

                        <div className="flex items-start gap-2 text-xs text-muted-foreground">
                          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span>{group.address}</span>
                        </div>
                      </div>

                      <div className="w-fit rounded-full border border-border/70 bg-muted/20 px-2.5 py-1 text-xs text-muted-foreground">
                        {group.orders.length} משלוחים
                      </div>
                    </div>

                    <div className="mt-3 space-y-2">
                      {group.orders.map((delivery) => (
                        <div
                          key={delivery.id}
                          className="rounded-2xl border border-border/60 bg-muted/20 p-3"
                        >
                          <div className="flex flex-col gap-3">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <div className="font-medium">הזמנה #{delivery.id.slice(0, 8)}</div>
                                <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                                  <CalendarDays className="h-3.5 w-3.5" />
                                  <span>{formatShortDate(delivery.orderDate, "-")}</span>
                                </div>
                              </div>
                              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-col sm:items-end">
                                <div className="rounded-xl border border-border/60 bg-background/70 px-2.5 py-1.5 text-xs">
                                  <div className="text-[11px] text-muted-foreground">סכום</div>
                                  <div className="font-medium">{formatCurrency(delivery.totalAmount)}</div>
                                </div>
                                <div className="rounded-xl border border-border/60 bg-background/70 px-2.5 py-1.5 text-xs">
                                  <div className="text-[11px] text-muted-foreground">סטטוס</div>
                                  <div className="font-medium">{getOrderStatusLabel(delivery.status)}</div>
                                </div>
                              </div>
                            </div>

                            {delivery.notes ? (
                              <div className="rounded-xl border border-border/50 bg-background/70 px-3 py-2 text-xs text-muted-foreground">
                                {delivery.notes}
                              </div>
                            ) : null}

                            <div className="grid gap-2 sm:flex sm:flex-wrap">
                              <div className="w-full sm:w-auto">
                                <OrderConfirmDialog orderId={delivery.id} buttonLabel="אישור אספקה" />
                              </div>
                              <Button asChild type="button" variant="secondary" size="sm" className="w-full sm:w-auto" onClick={() => emitNavigationStart()}>
                                <Link href={`/sales/orders/${delivery.id}`}>צפייה בפרטים</Link>
                              </Button>
                            </div>
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

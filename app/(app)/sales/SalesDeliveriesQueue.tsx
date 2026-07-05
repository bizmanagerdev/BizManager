"use client";

import Link from "next/link";
import { useCallback, useMemo } from "react";
import { MapPin, Phone, Truck } from "lucide-react";
import OrderConfirmDialog from "@/app/(app)/sales/orders/OrderConfirmDialog";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { AddressLink } from "@/components/ui/address-link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DELIVERY_REGIONS, getCityRegion } from "@/lib/ui/cities";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { loadMoreDeliveries } from "@/app/(app)/sales/actions";
import { paymentStatusClasses, paymentStatusLabel } from "@/lib/orders/paymentStatus";
import type { DeliveryItem } from "@/app/(app)/sales/loadDeliveries";

type CustomerGroup = {
  customerName: string;
  customerPhone: string | null;
  address: string;
  orders: DeliveryItem[];
};

type RegionLink = {
  label: string;
  value: string | null;
  href: string;
  active: boolean;
};

// region → city → [customerKey, group]
type GroupedDeliveries = ReadonlyArray<
  readonly [string, ReadonlyArray<readonly [string, ReadonlyArray<readonly [string, CustomerGroup]>]>]
>;

function buildCustomerGroups(cityDeliveries: DeliveryItem[]) {
  return Array.from(
    cityDeliveries.reduce((map, delivery) => {
      const customerKey =
        delivery.customerId ||
        `${delivery.customerName}|${delivery.address}|${delivery.customerPhone ?? ""}`;
      const existing = map.get(customerKey);
      if (existing) {
        existing.orders.push(delivery);
        return map;
      }
      map.set(customerKey, {
        customerName: delivery.customerName,
        customerPhone: delivery.customerPhone,
        address: delivery.address,
        orders: [delivery],
      });
      return map;
    }, new Map<string, CustomerGroup>())
  );
}

// Group the (region-filtered) deliveries into region → city → customer for display.
function groupDeliveries(deliveries: DeliveryItem[], regionFilter: string | null): GroupedDeliveries {
  const visible = regionFilter
    ? deliveries.filter((d) => getCityRegion(d.city) === regionFilter)
    : deliveries;

  const byRegionMap = new Map<string, Map<string, DeliveryItem[]>>();
  for (const delivery of visible) {
    const region = getCityRegion(delivery.city) ?? "לא ידוע";
    if (!byRegionMap.has(region)) byRegionMap.set(region, new Map());
    const byCity = byRegionMap.get(region)!;
    const list = byCity.get(delivery.city) ?? [];
    list.push(delivery);
    byCity.set(delivery.city, list);
  }

  const REGION_ORDER = [...DELIVERY_REGIONS, "לא ידוע"];
  return REGION_ORDER.filter((r) => byRegionMap.has(r)).map((region) => {
    const citiesMap = byRegionMap.get(region)!;
    const cities = Array.from(citiesMap.entries())
      .sort(([a], [b]) => a.localeCompare(b, "he"))
      .map(([city, cityDeliveries]) => [city, buildCustomerGroups(cityDeliveries)] as const);
    return [region, cities] as const;
  });
}

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
  initialDeliveries,
  initialHasMore = false,
  regionFilter,
  regionLinks,
  totalCount,
  customerId = null,
}: {
  initialDeliveries: DeliveryItem[];
  initialHasMore?: boolean;
  regionFilter: string | null;
  regionLinks: RegionLink[];
  totalCount: number;
  customerId?: string | null;
}) {
  // Fetch-from-DB-as-you-scroll: accumulate delivery pages, then group region →
  // city → customer over everything loaded so far (no "next page" button).
  const fetchFilters = useMemo(() => ({ customerId }), [customerId]);
  const fetchPage = useCallback((page: number) => loadMoreDeliveries(page, fetchFilters), [fetchFilters]);
  const getRowId = useCallback((delivery: DeliveryItem) => delivery.id, []);
  const {
    rows: deliveries,
    hasMore,
    loading: loadingMore,
    sentinelRef,
  } = useInfiniteScroll<DeliveryItem>({
    initialRows: initialDeliveries,
    initialHasMore,
    fetchPage,
    getId: getRowId,
  });

  const deliveriesByRegion = useMemo(
    () => groupDeliveries(deliveries, regionFilter),
    [deliveries, regionFilter]
  );

  const totalVisible = deliveriesByRegion.reduce(
    (sum, [, cities]) =>
      sum +
      cities.reduce(
        (s, [, groups]) => s + groups.reduce((gs, [, g]) => gs + g.orders.length, 0),
        0
      ),
    0
  );

  return (
    <div className="space-y-3">
      {/* Region filter tabs */}
      <div className="flex flex-wrap items-center gap-2">
        {regionLinks.map(({ label, href, active }) => (
          <Link
            key={label}
            href={href}
            onClick={() => emitNavigationStart()}
            className={[
              "rounded-full border px-3 py-1 text-sm transition-colors",
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
            ].join(" ")}
          >
            {label}
          </Link>
        ))}
        <span className="mr-auto text-xs text-muted-foreground">
          {regionFilter ? `${totalVisible} משלוחים באזור ${regionFilter}` : `${totalCount} משלוחים`}
        </span>
      </div>

      {deliveriesByRegion.length === 0 ? (
        <p className="text-sm text-muted-foreground">אין כרגע הזמנות מקובצות למשלוחים.</p>
      ) : (
        deliveriesByRegion.map(([region, cities]) => {
          const regionTotal = cities.reduce(
            (sum, [, groups]) => sum + groups.reduce((s, [, g]) => s + g.orders.length, 0),
            0
          );
          const regionCustomers = cities.reduce((sum, [, groups]) => sum + groups.length, 0);

          return (
            <div key={region} className="space-y-2">
              {/* Region header */}
              <div className="flex items-center gap-3 px-1">
                <div className="h-px flex-1 bg-border/60" />
                <span className="text-sm font-semibold text-foreground">{region}</span>
                <span className="rounded-full border border-border/70 bg-background px-2 py-0.5 text-xs text-muted-foreground">
                  {regionCustomers} לקוחות • {regionTotal} משלוחים
                </span>
                <div className="h-px flex-1 bg-border/60" />
              </div>

              {/* Cities in region */}
              {cities.map(([city, customerGroups]) => (
                <Card key={city} className="overflow-hidden border-2 border-primary/60">
                  <CardContent className="space-y-3 p-3 sm:p-4">
                    <div className="flex items-center justify-between gap-2 border-b border-border/60 pb-2">
                      <div className="flex items-center gap-2">
                        <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-info/30 bg-info-soft text-info-soft-foreground">
                          <Truck className="h-4 w-4" />
                        </div>
                        <h3 className="text-base font-bold">{city}</h3>
                      </div>
                      <span className="shrink-0 rounded-full border border-info/40 bg-info-soft/50 px-2.5 py-1 text-xs font-medium text-info-soft-foreground">
                        {customerGroups.length} לקוחות •{" "}
                        {customerGroups.reduce((sum, [, group]) => sum + group.orders.length, 0)} משלוחים
                      </span>
                    </div>

                    <ul className="space-y-2">
                      {customerGroups.map(([customerKey, group]) => {
                        const customerPhoneHref = phoneHref(group.customerPhone);

                        const hasMultipleOrders = group.orders.length > 1;

                        return (
                          <li key={customerKey}>
                            <div className="rounded-lg border-2 border-secondary/40 bg-background/80 px-2.5 py-2">
                            <div className="flex items-center gap-x-2 text-xs">
                              <span className="truncate text-sm font-semibold">{group.customerName}</span>
                              {group.customerPhone ? (
                                customerPhoneHref ? (
                                  <a
                                    href={customerPhoneHref}
                                    className="inline-flex shrink-0 items-center gap-0.5 text-muted-foreground hover:text-foreground"
                                  >
                                    <Phone className="h-3 w-3" />
                                    <span dir="ltr">{group.customerPhone}</span>
                                  </a>
                                ) : (
                                  <span className="inline-flex shrink-0 items-center gap-0.5 text-muted-foreground">
                                    <Phone className="h-3 w-3" />
                                    <span dir="ltr">{group.customerPhone}</span>
                                  </span>
                                )
                              ) : null}
                              {hasMultipleOrders ? (
                                <span className="mr-auto shrink-0 text-muted-foreground">{group.orders.length} משלוחים</span>
                              ) : null}
                            </div>
                            <div className="mt-0.5 flex items-center gap-0.5 text-xs text-muted-foreground">
                              <MapPin className="h-3 w-3 shrink-0" />
                              <span className="truncate">
                                {group.address ? <AddressLink address={group.address} /> : group.address}
                              </span>
                            </div>

                            <ul
                              className={
                                hasMultipleOrders
                                  ? "me-[3px] mt-1.5 space-y-0.5 border-e-2 border-info/30 pe-3"
                                  : "mt-0.5"
                              }
                            >
                              {group.orders.map((delivery) => (
                                <li
                                  key={delivery.id}
                                  title={delivery.notes ?? undefined}
                                  className="py-1 text-xs hover:bg-muted/20"
                                >
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium">{formatCurrency(delivery.totalAmount)}</span>
                                    <span
                                      className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${paymentStatusClasses(delivery.paymentStatus)}`}
                                    >
                                      {paymentStatusLabel(delivery.paymentStatus)}
                                    </span>
                                    {delivery.collectOnDelivery ? (
                                      <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
                                        גבייה ע&quot;י הנהג
                                      </span>
                                    ) : null}
                                    <div className="mr-auto flex shrink-0 gap-1">
                                      <OrderConfirmDialog
                                        orderId={delivery.id}
                                        buttonLabel="אספקה"
                                        buttonClassName="h-6 px-2 text-xs"
                                      />
                                      <Button
                                        asChild
                                        type="button"
                                        variant="secondary"
                                        size="sm"
                                        className="h-6 px-2 text-xs"
                                        onClick={() => emitNavigationStart()}
                                      >
                                        <Link href={`/sales/orders/${delivery.id}`}>פרטים</Link>
                                      </Button>
                                    </div>
                                  </div>
                                  {delivery.items.length > 0 ? (
                                    <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                                      {delivery.items.map((item, itemIndex) => (
                                        <span key={`${delivery.id}-${itemIndex}`}>
                                          ×{item.quantity} {item.name}
                                          {item.notes ? ` (${item.notes})` : ""}
                                        </span>
                                      ))}
                                    </div>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </CardContent>
                </Card>
              ))}
            </div>
          );
        })
      )}

      {hasMore ? <div ref={sentinelRef} className="h-1" /> : null}
      {deliveries.length > 0 ? (
        <div className="pt-1 text-center text-xs text-muted-foreground">
          {loadingMore ? "טוען…" : `נטענו ${deliveries.length} מתוך ${totalCount} משלוחים`}
        </div>
      ) : null}
    </div>
  );
}

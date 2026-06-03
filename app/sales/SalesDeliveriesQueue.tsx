"use client";

import Link from "next/link";
import { useCallback, useMemo } from "react";
import { MapPin, Phone, Truck } from "lucide-react";
import OrderConfirmDialog from "@/app/sales/orders/OrderConfirmDialog";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatShortDate } from "@/lib/date";
import { getOrderStatusLabel } from "@/lib/ui/status-colors";
import { DELIVERY_REGIONS, getCityRegion } from "@/lib/ui/cities";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { loadMoreDeliveries } from "@/app/sales/actions";
import type { DeliveryItem } from "@/app/sales/loadDeliveries";

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
                <Card key={city} className="overflow-hidden">
                  <CardContent className="space-y-3 p-3 sm:p-4">
                    <div className="flex flex-col gap-2 border-b border-border/60 pb-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-2">
                        <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-info/30 bg-info-soft text-info-soft-foreground">
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

"use client";

import Link from "next/link";
import { useCallback, useMemo } from "react";
import { Check, Eye, MapPin, Phone } from "lucide-react";
import { WazeIcon } from "@/components/ui/waze-icon";
import OrderConfirmDialog from "@/app/(app)/sales/orders/OrderConfirmDialog";
import DeliveryShareActions from "@/app/(app)/sales/DeliveryShareActions";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { AddressLink } from "@/components/ui/address-link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DELIVERY_REGIONS, formatDeliveryAddress, getCityRegion } from "@/lib/ui/cities";
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

  // Desktop shows one column per region (south · center · north, read RTL). When
  // a region filter is active we only render that region. Empty known regions
  // still get a column so the three lists stay side by side.
  const citiesByRegion = new Map(deliveriesByRegion);
  const columnRegions = regionFilter
    ? deliveriesByRegion.map(([region]) => region)
    : ["דרום", "מרכז", "צפון", ...(citiesByRegion.has("לא ידוע") ? ["לא ידוע"] : [])];

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
        <div className={regionFilter ? "space-y-3" : "grid items-start gap-4 lg:grid-cols-3"}>
        {columnRegions.map((region) => {
          const cities = citiesByRegion.get(region) ?? [];
          const regionTotal = cities.reduce(
            (sum, [, groups]) => sum + groups.reduce((s, [, g]) => s + g.orders.length, 0),
            0
          );
          const regionCustomers = cities.reduce((sum, [, groups]) => sum + groups.length, 0);

          return (
            <div key={region} className="space-y-2">
              {/* Region column header */}
              <div className="flex items-center justify-between gap-2 px-1">
                <span className="text-sm font-bold text-foreground">{region}</span>
                <span className="rounded-full border border-border/70 bg-background px-2 py-0.5 text-xs text-muted-foreground">
                  {regionCustomers} לקוחות • {regionTotal} משלוחים
                </span>
              </div>

              {cities.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border/60 p-4 text-center text-xs text-muted-foreground">
                  אין משלוחים באזור זה
                </p>
              ) : null}

              {/* Cities in region */}
              {cities.map(([city, customerGroups]) => (
                <Card key={city} className="overflow-hidden">
                  <CardContent className="space-y-3 p-3 sm:p-4">
                    <div className="flex items-center justify-between gap-2 border-b border-border/60 pb-2">
                      <div className="flex items-center gap-2">
                        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
                          <MapPin className="h-4 w-4" />
                        </div>
                        <h3 className="text-base font-bold">{city}</h3>
                      </div>
                      <span className="shrink-0 rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs font-medium text-muted-foreground">
                        {customerGroups.length} לקוחות •{" "}
                        {customerGroups.reduce((sum, [, group]) => sum + group.orders.length, 0)} משלוחים
                      </span>
                    </div>

                    <ul className="space-y-3">
                      {customerGroups.map(([customerKey, group]) => {
                        const customerPhoneHref = phoneHref(group.customerPhone);
                        const displayAddress = formatDeliveryAddress({ address: group.address, city });

                        const hasMultipleOrders = group.orders.length > 1;

                        return (
                          <li key={customerKey}>
                            <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
                              {/* Customer header: name + phone, and amount (single) / count (multi) */}
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-bold">{group.customerName}</div>
                                  {group.customerPhone ? (
                                    customerPhoneHref ? (
                                      <a
                                        href={customerPhoneHref}
                                        className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                                      >
                                        <Phone className="h-3 w-3" />
                                        <span dir="ltr">{group.customerPhone}</span>
                                      </a>
                                    ) : (
                                      <span className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground">
                                        <Phone className="h-3 w-3" />
                                        <span dir="ltr">{group.customerPhone}</span>
                                      </span>
                                    )
                                  ) : null}
                                  {displayAddress ? (
                                    <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                                      <WazeIcon className="h-3.5 w-3.5 shrink-0" />
                                      <span className="truncate">
                                        <AddressLink address={displayAddress} />
                                      </span>
                                    </div>
                                  ) : null}
                                </div>
                                {hasMultipleOrders ? (
                                  <span className="shrink-0 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                                    {group.orders.length} משלוחים
                                  </span>
                                ) : (
                                  <div className="flex shrink-0 flex-col items-end gap-1">
                                    <span className="text-base font-bold">
                                      {formatCurrency(group.orders[0]?.totalAmount ?? null)}
                                    </span>
                                    <span
                                      className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${paymentStatusClasses(group.orders[0]?.paymentStatus ?? "unpaid")}`}
                                    >
                                      {paymentStatusLabel(group.orders[0]?.paymentStatus ?? "unpaid")}
                                    </span>
                                    {group.orders[0]?.collectOnDelivery ? (
                                      <span className="inline-flex rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">
                                        גבייה ע&quot;י הנהג
                                      </span>
                                    ) : null}
                                  </div>
                                )}
                              </div>

                              {/* Orders */}
                              <div className={hasMultipleOrders ? "mt-3 space-y-2" : "mt-3"}>
                                {group.orders.map((delivery) => (
                                  <div
                                    key={delivery.id}
                                    title={delivery.notes ?? undefined}
                                    className={hasMultipleOrders ? "rounded-lg border border-border/70 p-2" : ""}
                                  >
                                    {hasMultipleOrders ? (
                                      <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-sm font-bold">
                                          {formatCurrency(delivery.totalAmount)}
                                        </span>
                                        <span
                                          className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${paymentStatusClasses(delivery.paymentStatus)}`}
                                        >
                                          {paymentStatusLabel(delivery.paymentStatus)}
                                        </span>
                                        {delivery.collectOnDelivery ? (
                                          <span className="inline-flex rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">
                                            גבייה ע&quot;י הנהג
                                          </span>
                                        ) : null}
                                      </div>
                                    ) : null}

                                    {delivery.items.length > 0 ? (
                                      <div className="mt-2 rounded-lg bg-muted/50 p-2">
                                        <div className="flex flex-wrap gap-1 text-xs">
                                          {delivery.items.map((item, itemIndex) => (
                                            <span
                                              key={`${delivery.id}-${itemIndex}`}
                                              className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background px-2 py-0.5 text-foreground"
                                            >
                                              <span className="font-semibold">{item.quantity}</span>
                                              <span>
                                                {item.name}
                                                {item.notes ? ` (${item.notes})` : ""}
                                              </span>
                                            </span>
                                          ))}
                                        </div>
                                      </div>
                                    ) : null}

                                    <div className="mt-2 grid grid-cols-3 gap-2 border-t border-border/60 pt-2">
                                      <OrderConfirmDialog
                                        orderId={delivery.id}
                                        buttonVariant="default"
                                        buttonClassName="w-full gap-1"
                                        buttonLabel={
                                          <>
                                            <Check className="h-4 w-4" />
                                            אספקה
                                          </>
                                        }
                                      />
                                      <Button
                                        asChild
                                        type="button"
                                        variant="secondary"
                                        size="sm"
                                        className="w-full gap-1"
                                        onClick={() => emitNavigationStart()}
                                      >
                                        <Link href={`/sales/orders/${delivery.id}`}>
                                          <Eye className="h-4 w-4" />
                                          פרטים
                                        </Link>
                                      </Button>
                                      <DeliveryShareActions delivery={delivery} className="w-full" />
                                    </div>
                                  </div>
                                ))}
                              </div>
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
        })}
        </div>
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

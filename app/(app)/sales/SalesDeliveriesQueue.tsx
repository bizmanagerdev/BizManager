"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { CashIcon, CheckIcon, ChevronDownIcon, LocationIcon, PhoneIcon, WazeIcon } from "@/components/ui/icons";
import OrderConfirmDialog from "@/app/(app)/sales/orders/OrderConfirmDialog";
import DeliveryShareActions from "@/app/(app)/sales/DeliveryShareActions";
import PickingListDialog from "@/app/(app)/sales/PickingListDialog";
import { useSetPageTitle } from "@/components/layout/page-title-context";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { AddressLink } from "@/components/ui/address-link";
import { ContactLink, ContactTapZone } from "@/components/ui/contact-link";
import { Card } from "@/components/ui/card";

import { DELIVERY_REGIONS, formatDeliveryAddress, getCityRegion } from "@/lib/ui/cities";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { loadMoreDeliveries } from "@/app/(app)/sales/actions";
import { paymentStatusClasses } from "@/lib/orders/paymentStatus";
import { getPaymentStatusLabel } from "@/lib/ui/status-colors";
import {
  prepaymentBadgeClasses,
  PREPAYMENT_ROW_CLASSES,
} from "@/lib/orders/prepayment";
import { combinedCustomerName, type DeliveryItem, type DeliveryOrderItem } from "@/app/(app)/sales/loadDeliveries";
import { pinFrom, wazeLinkForPin, type DeliveryPin } from "@/lib/delivery-location";
import { DeliveryLocationDialog } from "@/components/orders/DeliveryLocationDialog";
import { rowNavigateProps } from "@/lib/ui/row-navigation";
import { ResponsiveDataView } from "@/components/ui/responsive-data-view";

type CustomerGroup = {
  customerId: string;
  customerName: string;
  /** Set only when every order in this group is for the same specific branch. */
  customerBranchName: string | null;
  customerPhone: string | null;
  address: string;
  orders: DeliveryItem[];
  /** Standing arrival directions + saved drop-off pin, carried from the customer. */
  deliveryInstructions: string | null;
  deliveryLat: number | null;
  deliveryLng: number | null;
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
      // Branch is part of the key: two branches of the same customer are two
      // different delivery stops (different address) and must never merge
      // into one group under the customer's plain id.
      const customerKey = delivery.customerId
        ? `${delivery.customerId}:${delivery.branchId ?? ""}`
        : `${delivery.customerName}|${delivery.address}|${delivery.customerPhone ?? ""}`;
      const existing = map.get(customerKey);
      if (existing) {
        existing.orders.push(delivery);
        return map;
      }
      map.set(customerKey, {
        customerId: delivery.customerId,
        customerName: delivery.customerName,
        customerBranchName: delivery.customerBranchName,
        customerPhone: delivery.customerPhone,
        address: delivery.address,
        orders: [delivery],
        deliveryInstructions: delivery.deliveryInstructions,
        deliveryLat: delivery.deliveryLat,
        deliveryLng: delivery.deliveryLng,
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

// Higher than the orders list's 3: this IS the packing list, so the driver should
// see the load. The cap only exists to stop a huge order from burying the card.
const DELIVERY_ITEMS_LIMIT = 8;

/** The still-outstanding line items: drop what's already fully delivered, and
 * show the remaining quantity rather than the original ordered quantity — this
 * queue is what's left to load, not a record of what already went out. */
function remainingDeliveryItems(items: DeliveryOrderItem[]) {
  return items
    .map((item) => ({ ...item, remaining: item.quantity - item.delivered }))
    .filter((item) => item.remaining > 0);
}

function formatCurrency(value: number | null) {
  if (value === null) return "-";
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

export default function SalesDeliveriesQueue({
  initialDeliveries,
  initialHasMore = false,
  regionFilter,
  regionLinks,
  totalCount,
  customerId = null,
  canOpenOrder = true,
}: {
  initialDeliveries: DeliveryItem[];
  initialHasMore?: boolean;
  regionFilter: string | null;
  regionLinks: RegionLink[];
  totalCount: number;
  customerId?: string | null;
  /**
   * Whether the viewer may open the full order screen. False for a worker —
   * /sales is staff-only, so the link would bounce him to /no-access. He still
   * gets everything the drive needs: the item list, navigation, share, and
   * "סמן כסופק" (which collects payment too).
   */
  canOpenOrder?: boolean;
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
  const router = useRouter();

  // One shared editor for the whole queue — a card sets its target rather than
  // each card mounting its own dialog.
  const [locationTarget, setLocationTarget] = useState<{
    customerId: string;
    customerName: string;
    instructions: string | null;
    pin: DeliveryPin | null;
  } | null>(null);

  // Desktop table: each region is a collapsible section inside one big table.
  const [collapsedRegions, setCollapsedRegions] = useState<Record<string, boolean>>({});
  const toggleRegion = (region: string) =>
    setCollapsedRegions((prev) => ({ ...prev, [region]: !prev[region] }));

  const citiesByRegion = new Map(deliveriesByRegion);
  // Full-width sections stacked one after another, ordered south → center → north
  // (then "unknown"). Empty regions are dropped entirely — no title, no placeholder.
  const orderedRegions = (["דרום", "מרכז", "צפון", "לא ידוע"] as const)
    .map((region) => [region, citiesByRegion.get(region) ?? []] as const)
    .filter(([, cities]) => cities.length > 0);

  // Names the page in the mobile top bar; the count follows the region filter.
  useSetPageTitle(
    "משלוחים",
    regionFilter ? `${totalVisible} באזור ${regionFilter}` : `${totalCount} משלוחים`
  );
  return (
    <div className="space-y-3">
      {locationTarget ? (
        <DeliveryLocationDialog
          open
          onOpenChange={(open) => {
            if (!open) setLocationTarget(null);
          }}
          customerId={locationTarget.customerId}
          customerName={locationTarget.customerName}
          initialInstructions={locationTarget.instructions}
          initialPin={locationTarget.pin}
          onSaved={() => router.refresh()}
        />
      ) : null}

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
        <PickingListDialog />
        {/* Desktop only: on a phone this wrapped onto a line of its own under
            the pills — a whole row of screen for a number you can see by
            scrolling. Beside the pills on a wider screen it costs nothing. */}
        <span className="mr-auto hidden text-xs text-muted-foreground md:inline">
          {regionFilter
            ? `${totalVisible} משלוחים באזור ${regionFilter}`
            : `${totalCount} משלוחים`}
        </span>
      </div>

      {deliveriesByRegion.length === 0 ? (
        <p className="text-sm text-muted-foreground">אין כרגע הזמנות מקובצות למשלוחים.</p>
      ) : (
        <ResponsiveDataView
          breakpoint="xl"
          desktop={
            // A column table per region, stacked south → center → north.
            // Mobile keeps the richer stop cards below.
            <Card className="overflow-hidden border-border/70 shadow-sm">
              <div className="max-h-[75vh] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-muted text-muted-foreground">
                    <tr className="border-b border-border/70 text-right">
                      <th className="px-4 py-3 font-medium">לקוח</th>
                      <th className="px-4 py-3 font-medium">עיר</th>
                      <th className="px-4 py-3 font-medium">כתובת</th>
                      <th className="px-4 py-3 font-medium">מוצרים</th>
                      <th className="px-4 py-3 font-medium">סכום</th>
                      <th className="px-4 py-3 font-medium">פעולות</th>
                    </tr>
                  </thead>
                  {orderedRegions.map(([region, cities]) => {
                    const regionCustomers = cities.reduce((sum, [, groups]) => sum + groups.length, 0);
                    const rows = cities.flatMap(([city, customerGroups]) =>
                      customerGroups.flatMap(([, group]) => {
                        const groupPin = pinFrom(group.deliveryLat, group.deliveryLng);
                        return group.orders.map((delivery) => ({ city, group, groupPin, delivery }));
                      })
                    );
                    const collapsed = collapsedRegions[region] === true;
                    return (
                      <tbody key={region} className="divide-y divide-border/70">
                        {/* Collapsible region header row spanning the whole table. */}
                        <tr
                          className="cursor-pointer bg-muted/40 hover:bg-muted/60"
                          onClick={() => toggleRegion(region)}
                        >
                          <td colSpan={6} className="px-4 py-2">
                            <div className="flex items-center gap-2">
                              <ChevronDownIcon
                                className={`h-4 w-4 shrink-0 transition-transform ${collapsed ? "-rotate-90" : ""}`}
                              />
                              <span className="text-sm font-bold text-foreground">{region}</span>
                              <span className="text-xs text-muted-foreground">
                                · {regionCustomers} לקוחות · {rows.length} משלוחים
                              </span>
                            </div>
                          </td>
                        </tr>
                        {collapsed
                          ? null
                          : rows.map(({ city, group, groupPin, delivery }) => {
                          const unpaidPrepayment =
                            delivery.requiresPrepayment && delivery.paymentStatus !== "paid";
                          const partiallyDelivered = delivery.status === "partially_delivered";
                          const displayAddress = formatDeliveryAddress({ address: group.address, city });
                          return (
                            <tr
                              key={delivery.id}
                              // Lets ?focus=<order id> scroll to this delivery and
                              // flash it (components/layout/FocusHighlighter.tsx) —
                              // that's how the dashboard widget links through.
                              data-focus-id={delivery.id}
                              className={`align-top ${canOpenOrder ? "cursor-pointer hover:bg-muted/20 focus-visible:bg-muted/20" : ""} ${unpaidPrepayment ? PREPAYMENT_ROW_CLASSES : ""}`}
                              {...(canOpenOrder ? rowNavigateProps(router, `/sales/orders/${delivery.id}`) : {})}
                            >
                              <td className="px-4 py-3">
                                <div className="font-medium">{combinedCustomerName(group)}</div>
                                {group.customerPhone ? (
                                  <ContactLink
                                    kind="tel"
                                    value={group.customerPhone}
                                    className="text-xs text-muted-foreground hover:underline"
                                  />
                                ) : null}
                              </td>
                              <td className="whitespace-nowrap px-4 py-3">{city}</td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  {groupPin ? (
                                    <a
                                      href={wazeLinkForPin(groupPin)}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-secondary px-2 py-1 text-xs text-secondary-foreground no-underline"
                                    >
                                      <WazeIcon className="h-3.5 w-3.5" />
                                      נקודה
                                    </a>
                                  ) : displayAddress ? (
                                    <AddressLink
                                      address={group.address}
                                      city={city}
                                      className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-secondary px-2 py-1 text-xs text-secondary-foreground no-underline hover:!text-secondary-foreground hover:!no-underline"
                                    >
                                      <WazeIcon className="h-3.5 w-3.5" />
                                      וייז
                                    </AddressLink>
                                  ) : null}
                                  <span className="min-w-0">{displayAddress || "-"}</span>
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex flex-wrap items-center gap-1 text-xs">
                                  {partiallyDelivered ? (
                                    <span className="rounded-full border border-warning bg-warning-soft px-2 py-0.5 text-[11px] font-semibold text-warning-soft-foreground">
                                      יתרת אספקה
                                    </span>
                                  ) : null}
                                  {(() => {
                                    const pending = remainingDeliveryItems(delivery.items);
                                    return (
                                      <>
                                        {pending.slice(0, DELIVERY_ITEMS_LIMIT).map((item, idx) => (
                                          <span
                                            key={`${delivery.id}-${idx}`}
                                            className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-border/60 bg-background px-2 py-0.5 text-foreground"
                                          >
                                            {item.remaining > 0 ? <span className="font-semibold">{item.remaining}</span> : null}
                                            <span>
                                              {item.name}
                                              {item.notes ? ` (${item.notes})` : ""}
                                            </span>
                                          </span>
                                        ))}
                                        {pending.length > DELIVERY_ITEMS_LIMIT ? (
                                          canOpenOrder ? (
                                            <Link
                                              href={`/sales/orders/${delivery.id}`}
                                              onClick={() => emitNavigationStart()}
                                              className="inline-flex items-center whitespace-nowrap rounded-md border border-dashed border-border/60 px-2 py-0.5 text-muted-foreground hover:text-foreground"
                                            >
                                              +{pending.length - DELIVERY_ITEMS_LIMIT} נוספים
                                            </Link>
                                          ) : (
                                            <span className="inline-flex items-center whitespace-nowrap rounded-md border border-dashed border-border/60 px-2 py-0.5 text-muted-foreground">
                                              +{pending.length - DELIVERY_ITEMS_LIMIT} נוספים
                                            </span>
                                          )
                                        ) : null}
                                      </>
                                    );
                                  })()}
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <div className="space-y-1">
                                  <div className="font-semibold">{formatCurrency(delivery.totalAmount)}</div>
                                  <div className="flex flex-wrap gap-1">
                                    {unpaidPrepayment ? (
                                      <span
                                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${prepaymentBadgeClasses}`}
                                      >
                                        תשלום מראש — לא נגבה
                                      </span>
                                    ) : null}
                                    <span
                                      className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${paymentStatusClasses(delivery.paymentStatus)}`}
                                    >
                                      {getPaymentStatusLabel(delivery.paymentStatus)}
                                    </span>
                                    {delivery.collectOnDelivery ? (
                                      <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-semibold text-warning-soft-foreground">
                                        <CashIcon className="h-3.5 w-3.5 shrink-0" />
                                        גבייה במסירה
                                      </span>
                                    ) : null}
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <DeliveryShareActions
                                    delivery={delivery}
                                    label=""
                                    variant="ghost"
                                    className="h-9 w-9 shrink-0 p-0"
                                  />
                                  <OrderConfirmDialog
                                    orderId={delivery.id}
                                    customerName={delivery.customerName}
                                    buttonVariant="default"
                                    buttonClassName="gap-1.5"
                                    buttonLabel={
                                      <>
                                        <CheckIcon className="h-4 w-4" />
                                        סמן כסופק
                                      </>
                                    }
                                  />
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    );
                  })}
                </table>
              </div>
            </Card>
          }
          mobile={
            // Stop cards grouped region → city → customer.
            <div className="space-y-4">
              {orderedRegions.map(([region, cities]) => {
                return (
                  <div key={region} className="min-w-0 space-y-2">
                    {/* No region header bar on a phone: the filter pills above already
                        name the regions and switch between them, so a boxed "מרכז ·
                        7 לקוחות" between the stops was the same word again, costing a
                        row of screen on the one device with none to spare. The list is
                        still ordered by region, and the city headings carry the place. */}

                    {/* Cities in region */}
                    {cities.map(([city, customerGroups]) => (
                      <div key={city} className="space-y-2">
                        <div className="flex items-center justify-between gap-2 px-1">
                          <h3 className="flex min-w-0 items-center gap-1.5 text-base font-bold">
                            <LocationIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <span className="truncate">{city}</span>
                          </h3>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {customerGroups.length} עצירות
                          </span>
                        </div>

                        <ul className="space-y-2">
                            {customerGroups.map(([customerKey, group]) => {
                              const displayAddress = formatDeliveryAddress({ address: group.address, city });

                              const hasMultipleOrders = group.orders.length > 1;
                              const groupPin = pinFrom(group.deliveryLat, group.deliveryLng);

                              return (
                                <li key={customerKey}>
                                  <div className="relative overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                                    {/* Pinned beside the name/address heading — the card's
                                        first (and usually only) order. A second order on the
                                        same stop keeps its own share icon further down, since
                                        this corner can only speak for one delivery. */}
                                    <DeliveryShareActions
                                      delivery={group.orders[0]}
                                      label=""
                                      variant="ghost"
                                      className="absolute end-2 top-2 z-10 h-8 w-8 shrink-0 p-0"
                                    />
                                    {/* WHERE leads — on a delivery run the address is what
                                        you act on; the customer is how you confirm it. Waze
                                        sits opposite as the one navigation affordance. */}
                                    <div className="flex items-start gap-3 p-3">
                                      {/* A saved pin beats the address string — it's what
                                          stops Waze dropping the driver at the wrong
                                          entrance or the far side of a divided road. */}
                                      {groupPin ? (
                                        <a
                                          href={wazeLinkForPin(groupPin)}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="flex shrink-0 flex-col items-center gap-0.5 rounded-xl bg-secondary px-2.5 py-1.5 text-secondary-foreground no-underline"
                                        >
                                          <WazeIcon className="h-4 w-4" />
                                          <span className="text-[10px] font-semibold leading-none">נקודה</span>
                                        </a>
                                      ) : displayAddress ? (
                                        <AddressLink
                                          address={group.address}
                                          city={city}
                                          className="flex shrink-0 flex-col items-center gap-0.5 rounded-xl bg-secondary px-2.5 py-1.5 text-secondary-foreground no-underline hover:!text-secondary-foreground hover:!no-underline"
                                        >
                                          <WazeIcon className="h-4 w-4" />
                                        </AddressLink>
                                      ) : null}
                                      <div className="min-w-0 flex-1 pe-9">
                                        <div className="text-sm font-bold leading-snug">
                                          {group.address || combinedCustomerName(group)}
                                        </div>
                                        {displayAddress ? (
                                          <div className="text-xs text-muted-foreground">{combinedCustomerName(group)}</div>
                                        ) : null}
                                        {hasMultipleOrders ? (
                                          <span className="mt-1 inline-flex rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                                            {group.orders.length} משלוחים
                                          </span>
                                        ) : null}

                                        {/* The part an address can't say. Tap to edit — it
                                            saves on the CUSTOMER, so the next driver to
                                            come here inherits whatever this one worked out. */}
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setLocationTarget({
                                              customerId: group.customerId,
                                              customerName: group.customerName,
                                              instructions: group.deliveryInstructions,
                                              pin: groupPin,
                                            })
                                          }
                                          className="mt-1 flex w-full items-start gap-1 text-right text-xs text-muted-foreground hover:text-foreground"
                                        >
                                          <LocationIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                          <span className="min-w-0">
                                            {group.deliveryInstructions ?? (
                                              <span className="text-secondary">הוספת הוראות הגעה</span>
                                            )}
                                          </span>
                                        </button>
                                      </div>
                                    </div>

                                    {/* Who to call, as one tappable block — on the road this
                                        is a thumb target, not a line of text. */}
                                    {group.customerPhone ? (
                                      <div className="border-t border-border/60 p-3">
                                        {/* A div, not a link: tapping anywhere still calls
                                            (or copies, on desktop), but the name and number
                                            stay plain text so a long-press selects and copies
                                            them instead of opening the tel: link's own menu. */}
                                        <ContactTapZone
                                          kind="tel"
                                          value={group.customerPhone}
                                          className="flex items-center gap-2.5 rounded-xl bg-muted/50 p-2"
                                        >
                                          {/* Leading (right) edge, directly under the Waze
                                              tile: the two things you do at a stop line up in
                                              one column of tap targets instead of zig-zagging
                                              across the card. */}
                                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-success text-success-foreground">
                                            <PhoneIcon className="h-4 w-4" />
                                          </span>
                                          <span className="min-w-0 flex-1">
                                            <span className="block truncate text-sm font-semibold">
                                              {combinedCustomerName(group)}
                                            </span>
                                            {/* dir=ltr keeps the digits in dialling order, but
                                                it also left-aligns the box — text-right pulls
                                                it back under the name. */}
                                            <span dir="ltr" className="block text-right text-xs text-muted-foreground">
                                              {group.customerPhone}
                                            </span>
                                          </span>
                                        </ContactTapZone>
                                      </div>
                                    ) : null}

                                    {/* One ruled block per order, same zone rhythm as the
                                        orders list: money, then contents, then actions. */}
                                    {group.orders.map((delivery, orderIndex) => {
                                      const unpaidPrepayment =
                                        delivery.requiresPrepayment && delivery.paymentStatus !== "paid";
                                      const partiallyDelivered = delivery.status === "partially_delivered";
                                      return (
                                      <div
                                        key={delivery.id}
                                        data-focus-id={delivery.id}
                                        title={delivery.notes ?? undefined}
                                        {...(canOpenOrder ? rowNavigateProps(router, `/sales/orders/${delivery.id}`) : {})}
                                        className={`relative border-t border-border/60 ${canOpenOrder ? "cursor-pointer" : ""} ${
                                          unpaidPrepayment ? PREPAYMENT_ROW_CLASSES : ""
                                        }`}
                                      >
                                        {/* Order 0's share already sits up by the name/address
                                            heading — only a second+ order on the same stop needs
                                            its own corner, since the heading one can't speak for
                                            it. Sibling of the divided rows, not a member (no
                                            divide-y border of its own). */}
                                        {orderIndex > 0 ? (
                                          <DeliveryShareActions
                                            delivery={delivery}
                                            label=""
                                            variant="ghost"
                                            className="absolute end-2 top-2 z-10 h-8 w-8 shrink-0 p-0"
                                          />
                                        ) : null}
                                        <div className="divide-y divide-border/60">
                                        <div className={`flex flex-wrap items-center gap-x-2 gap-y-1.5 p-3 ${orderIndex > 0 ? "pe-12" : ""}`}>
                                          <span className="text-sm font-bold">
                                            {formatCurrency(delivery.totalAmount)}
                                          </span>
                                          {/* Pay-ahead customer, still owing: do NOT hand over
                                              the goods before it's paid. */}
                                          {unpaidPrepayment ? (
                                            <span
                                              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${prepaymentBadgeClasses}`}
                                            >
                                              תשלום מראש — לא נגבה
                                            </span>
                                          ) : null}
                                          <span
                                            className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${paymentStatusClasses(delivery.paymentStatus)}`}
                                          >
                                            {getPaymentStatusLabel(delivery.paymentStatus)}
                                          </span>
                                          {/* The one thing the driver must not miss. */}
                                          {delivery.collectOnDelivery ? (
                                            <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-semibold text-warning-soft-foreground">
                                              <CashIcon className="h-3.5 w-3.5 shrink-0" />
                                              גבייה במסירה
                                            </span>
                                          ) : null}
                                        </div>

                                        {/* Same list-cap rule as the orders list — it can't
                                            dribble into lonely single-chip lines. Unlike orders,
                                            nothing is hidden — the driver needs the full load —
                                            so the cap only applies past a point where the card
                                            would stop being scannable. */}
                                        {(() => {
                                          const pending = remainingDeliveryItems(delivery.items);
                                          if (pending.length === 0) return null;
                                          return (
                                          <div className="flex flex-wrap items-center gap-1 p-3 text-xs">
                                            {/* The remaining-delivery flag lives WITH the products —
                                                that's what it qualifies (what's still owed). */}
                                            {partiallyDelivered ? (
                                              <span className="rounded-full border border-warning bg-warning-soft px-2 py-0.5 text-[11px] font-semibold text-warning-soft-foreground">
                                                יתרת אספקה
                                              </span>
                                            ) : null}
                                            {pending.slice(0, DELIVERY_ITEMS_LIMIT).map((item, itemIndex) => (
                                              <span
                                                key={`${delivery.id}-${itemIndex}`}
                                                className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-border/60 bg-background px-2 py-0.5 text-foreground"
                                              >
                                                {item.remaining > 0 ? (
                                                  <span className="font-semibold">{item.remaining}</span>
                                                ) : null}
                                                <span>
                                                  {item.name}
                                                  {item.notes ? ` (${item.notes})` : ""}
                                                </span>
                                              </span>
                                            ))}
                                            {pending.length > DELIVERY_ITEMS_LIMIT ? (
                                              canOpenOrder ? (
                                                <Link
                                                  href={`/sales/orders/${delivery.id}`}
                                                  onClick={() => emitNavigationStart()}
                                                  className="inline-flex items-center whitespace-nowrap rounded-md border border-dashed border-border/60 px-2 py-0.5 text-muted-foreground hover:text-foreground"
                                                >
                                                  +{pending.length - DELIVERY_ITEMS_LIMIT} נוספים
                                                </Link>
                                              ) : (
                                                <span className="inline-flex items-center whitespace-nowrap rounded-md border border-dashed border-border/60 px-2 py-0.5 text-muted-foreground">
                                                  +{pending.length - DELIVERY_ITEMS_LIMIT} נוספים
                                                </span>
                                              )
                                            ) : null}
                                          </div>
                                          );
                                        })()}

                                        {/* The delivery itself is the primary act — the whole
                                            block is now a tap target to the order, so this row
                                            is just the one filled action, pinned to the bottom-left
                                            corner (ms-auto) to mirror the share icon's top-left. */}
                                        <div className="flex items-center gap-2 p-3">
                                          <OrderConfirmDialog
                                            orderId={delivery.id}
                                            customerName={delivery.customerName}
                                            buttonVariant="default"
                                            buttonClassName="ms-auto gap-1.5"
                                            buttonLabel={
                                              <>
                                                <CheckIcon className="h-4 w-4" />
                                                סמן כסופק
                                              </>
                                            }
                                          />
                                        </div>
                                        </div>
                                      </div>
                                      );
                                    })}
                                  </div>
                                </li>
                              );
                            })}
                        </ul>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          }
        />
      )}

      {hasMore ? <div ref={sentinelRef} className="h-1" /> : null}
      {deliveries.length > 0 ? (
        <div className="pt-1 text-center text-xs text-muted-foreground">
          {loadingMore
            ? "טוען…"
            : `נטענו ${deliveries.length} מתוך ${totalCount} משלוחים`}
        </div>
      ) : null}
    </div>
  );
}

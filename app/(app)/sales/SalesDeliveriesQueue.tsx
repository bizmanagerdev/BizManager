"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useDeferredValue, useMemo, useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Painted, SearchTermsProvider } from "@/components/search/Painted";
import { searchList, type SearchRecord } from "@/lib/search/listSearch";
import { CashIcon, ChevronDownIcon, CommentIcon, LocationIcon, RouteIcon, SearchIcon, WarehouseIcon, WazeIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { TOGGLE_OFF, TOGGLE_ON } from "@/components/ui/filter-chip";
import { formatMoney } from "@/lib/money";
import DeliveryShareActions from "@/app/(app)/sales/DeliveryShareActions";
import PickingListDialog from "@/app/(app)/sales/PickingListDialog";
import { useSetPageTitle } from "@/components/layout/page-title-context";
import { PageHeaderToolbar } from "@/components/layout/PageHeaderToolbar";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { AddressLink } from "@/components/ui/address-link";
import { CallGlyph, CallIconButton, ContactTapZone } from "@/components/ui/contact-link";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { LIST_CARD_BADGE, LIST_CARD_BODY, LIST_CARD_META, LIST_CARD_NAME } from "@/components/ui/list-card";
import { cn } from "@/lib/utils";

import { DELIVERY_REGIONS, formatDeliveryAddress, getCityRegion } from "@/lib/ui/cities";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { useLocalListPager } from "@/components/powersync/LocalListPager";
import { loadMoreDeliveries } from "@/app/(app)/sales/actions";
import { paymentStatusClasses } from "@/lib/orders/paymentStatus";
import { getPaymentStatusLabel } from "@/lib/ui/status-colors";
import { getStatusColorClasses } from "@/lib/ui/status-color-classes";
import {
  prepaymentBadgeClasses,
  PREPAYMENT_ROW_CLASSES,
} from "@/lib/orders/prepayment";
import { combinedCustomerName, type DeliveryItem, type DeliveryOrderItem } from "@/app/(app)/sales/loadDeliveries";
import { parseOrderComments } from "@/lib/orders/comments";
import { pinFrom, type DeliveryPin } from "@/lib/delivery-location";
import { dueUrgencyChipClass, formatShortDate, getDueUrgency } from "@/lib/date";
import { DeliveryLocationDialog } from "@/components/orders/DeliveryLocationDialog";
import { cityColour } from "@/lib/deliveries/city-colours";
import { useConfirmedDeliveries } from "@/lib/orders/confirmed-deliveries";
import { rowNavigateProps } from "@/lib/ui/row-navigation";
import { ResponsiveDataView } from "@/components/ui/responsive-data-view";

const OrderConfirmDialog = dynamic(() => import("@/app/(app)/sales/orders/OrderConfirmDialog"), {
  loading: () => null,
});

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
  addressNotFound?: boolean;
  addressUnit?: string | null;
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
        addressNotFound: delivery.addressNotFound,
        addressUnit: delivery.addressUnit,
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

/** The Waze button when Waze is blocked (no address, or not a full one): grey. */
const NO_ADDRESS_WAZE = "bg-muted text-muted-foreground hover:!text-muted-foreground";

/** The still-outstanding line items: drop what's already fully delivered, and
 * show the remaining quantity rather than the original ordered quantity — this
 * queue is what's left to load, not a record of what already went out. */
// The queue's search (owner, 2026-10-19: "deliveries … no search"), by the
// global search's rules: what the stop shows — the customer and branch, phone,
// city and address, the products, the comments, the sum, the asked-for day.
function deliverySearchRecord(delivery: DeliveryItem): SearchRecord {
  return {
    text: [
      [null, combinedCustomerName(delivery)],
      [null, delivery.city],
      [null, delivery.address],
      [null, delivery.items.map((item) => item.name).join(" | ")],
      [null, delivery.notes],
    ],
    amounts: [[null, delivery.totalAmount]],
    dates: [[null, delivery.requestedDeliveryDate]],
    phones: [[null, delivery.customerPhone]],
  };
}

function remainingDeliveryItems(items: DeliveryOrderItem[]) {
  return items
    .map((item) => ({ ...item, remaining: item.quantity - item.delivered }))
    .filter((item) => item.remaining > 0);
}

// ₪ first, the dashboard's way (owner, 2026-10-11) — lib/money.ts. A missing
// value is "—", as everywhere (owner, 2026-10-11).
function formatCurrency(value: number | null) {
  if (value === null) return "—";
  return formatMoney(value);
}

// The customer's own asked-for date, shown right on the queue card/row so a
// driver never has to open the order to see it — and colored the same way
// task due-dates are (red once it's already passed) so an overdue request
// actually stands out instead of reading as a plain label.
function RequestedDeliveryDateBadge({ date }: { date: string | null }) {
  if (!date) return null;
  const urgencyClass = dueUrgencyChipClass(getDueUrgency(date));
  return (
    <span
      className={cn(
        "rounded-full border",
        LIST_CARD_BADGE,
        urgencyClass || "border-border bg-muted/40 text-muted-foreground"
      )}
    >
      תאריך למשלוח: {formatShortDate(date)}
    </span>
  );
}

/**
 * The order's comments (its notes log, lib/orders/comments.ts) — what the
 * driver must know at the door ("call before", "leave at the side gate").
 * Each one with who wrote it and when, oldest first, as on the order's page.
 */
function DeliveryComments({ notes, className = "" }: { notes: string | null; className?: string }) {
  const comments = parseOrderComments(notes);
  if (comments.length === 0) return null;
  return (
    <ul className={`space-y-1.5 ${className}`}>
      {comments.map((comment, index) => (
        <li key={index} className="flex items-start gap-1.5 text-sm">
          <CommentIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="whitespace-pre-wrap break-words">{comment.body}</p>
            {comment.author_name || comment.created_at ? (
              <p className="text-[0.647rem] text-muted-foreground">
                {[comment.author_name, comment.created_at].filter(Boolean).join(" · ")}
              </p>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

// Same "חוסר במלאי" wording/styling as the orders list — reused here so a
// driver sees the risk before attempting a delivery that isn't actually
// in stock.
const lowStockBadgeClasses = getStatusColorClasses("danger");
function LowStockBadge({ outOfStock }: { outOfStock: boolean }) {
  if (!outOfStock) return null;
  return <span className={cn("rounded-full", LIST_CARD_BADGE, lowStockBadgeClasses)}>חוסר במלאי</span>;
}

export default function SalesDeliveriesQueue({
  initialDeliveries,
  initialHasMore = false,
  regionFilter,
  regionLinks,
  totalCount,
  customerId = null,
  canOpenOrder = true,
  loadedAt,
  regionsInHeaderStrip = false,
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
   * "אישור אספקה" (which collects payment too).
   */
  canOpenOrder?: boolean;
  /** When the server read these rows — an aged copy refreshes itself
   *  (useInfiniteScroll's loadedAt). */
  loadedAt?: number;
  /**
   * On a phone, the region pills (and the picking list) ride in the header
   * strip under the top bar — on the sales page, where every tab has one, so
   * switching tabs never moves the tabs or the list.
   */
  regionsInHeaderStrip?: boolean;
}) {
  // Fetch-from-DB-as-you-scroll: accumulate delivery pages, then group region →
  // city → customer over everything loaded so far (no "next page" button).
  const fetchFilters = useMemo(() => ({ customerId }), [customerId]);
  // The device version of the page (LocalSalesPage) serves further pages from the device copy.
  const localPager = useLocalListPager<DeliveryItem>();
  const fetchPage = useCallback(
    (page: number) => (localPager ? localPager(page) : loadMoreDeliveries(page, fetchFilters)),
    [fetchFilters, localPager]
  );
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
    loadedAt,
  });

  // Orders just confirmed on this phone leave the list at once, even while
  // the confirmation waits for a connection (lib/orders/confirmed-deliveries.ts).
  const confirmed = useConfirmedDeliveries();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const found = useMemo(
    () => searchList(deliveries, deliverySearchRecord, deferredSearch),
    [deliveries, deferredSearch]
  );
  const deliveriesByRegion = useMemo(() => {
    const open = confirmed.size > 0 ? deliveries.filter((delivery) => !confirmed.has(delivery.id)) : deliveries;
    return groupDeliveries(found ? open.filter((delivery) => found.reasons.has(delivery)) : open, regionFilter);
  }, [deliveries, regionFilter, confirmed, found]);

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
  const [, startTransition] = useTransition();

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
          onSaved={() => startTransition(() => { router.refresh(); })}
        />
      ) : null}

      {regionsInHeaderStrip ? (
        <PageHeaderToolbar>
          {/* One line that scrolls sideways rather than wrapping, so the strip
              is as tall as every other tab's. */}
          <div className="mx-auto flex w-full max-w-md items-center gap-2 overflow-x-auto">
            {regionLinks.map(({ label, href, active }) => (
              <Link
                key={label}
                href={href}
                onClick={() => emitNavigationStart()}
                className={[
                  "shrink-0 rounded-full border px-3 py-1 text-sm transition-colors",
                  // The app's one toggle look, blue when on (filter-chip.tsx).
                  active ? `border-secondary ${TOGGLE_ON}` : `border-border bg-background ${TOGGLE_OFF}`,
                ].join(" ")}
              >
                {label}
              </Link>
            ))}
            {/* Its icon only here — with the label it no longer fit beside the
                pills. The dashboard card's plain icon, no fill of its own
                (owner, 2026-10-11: it was a filled square here). */}
            <div className="shrink-0">
              <PickingListDialog
                trigger={
                  <button
                    type="button"
                    aria-label="רשימת ליקוט"
                    title="רשימת ליקוט"
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-secondary hover:bg-secondary/10"
                  >
                    <WarehouseIcon className="h-4 w-4" />
                  </button>
                }
              />
            </div>
            {/* The route planner (deliveries/route), icon only here like the picking list. */}
            <Link
              href="/deliveries/route"
              onClick={() => emitNavigationStart()}
              aria-label="תכנון מסלול"
              title="תכנון מסלול"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-secondary hover:bg-secondary/10"
            >
              <RouteIcon className="h-4 w-4" />
            </Link>
          </div>
        </PageHeaderToolbar>
      ) : null}

      {/* Region filter tabs (on the sales page's phone layout: in the strip above) */}
      <div className={regionsInHeaderStrip ? "hidden flex-wrap items-center gap-2 md:flex" : "flex flex-wrap items-center gap-2"}>
        {regionLinks.map(({ label, href, active }) => (
          <Link
            key={label}
            href={href}
            onClick={() => emitNavigationStart()}
            className={[
              "rounded-full border px-3 py-1 text-sm transition-colors",
              active ? `border-secondary ${TOGGLE_ON}` : `border-border bg-background ${TOGGLE_OFF}`,
            ].join(" ")}
          >
            {label}
          </Link>
        ))}
        <PickingListDialog />
        {/* The best order for the run, on Google's traffic (deliveries/route) —
            a helper beside the list, so the soft style like the picking list. */}
        <Button asChild variant="soft" size="sm" className="gap-1.5">
          <Link href="/deliveries/route" onClick={() => emitNavigationStart()}>
            <RouteIcon className="h-4 w-4" />
            <span>תכנון מסלול</span>
          </Link>
        </Button>
        {/* Desktop only: on a phone this wrapped onto a line of its own under
            the pills — a whole row of screen for a number you can see by
            scrolling. Beside the pills on a wider screen it costs nothing. */}
        <span className="mr-auto hidden text-xs text-muted-foreground md:inline">
          {regionFilter
            ? `${totalVisible} משלוחים באזור ${regionFilter}`
            : `${totalCount} משלוחים`}
        </span>
      </div>

      {deliveries.length > 0 ? (
        <div className="space-y-1">
          <div className="relative md:w-96">
            <SearchIcon className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="חיפוש משלוח — לקוח, עיר, מוצר, טלפון, סכום..."
              aria-label="חיפוש משלוח"
              className="h-10 ps-9"
            />
          </div>
          {found ? (
            <div className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                {totalVisible === 1 ? "נמצא משלוח אחד" : `נמצאו ${totalVisible} משלוחים`}
              </span>
              {/* Further pages aren't read yet: say the search covers what's here. */}
              {hasMore ? " · מתוך המשלוחים שנטענו — גללו לעוד" : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* An empty list has the app's one look (owner, 2026-10-11). */}
      {deliveriesByRegion.length === 0 ? (
        <EmptyState>{found ? "לא נמצאו משלוחים לחיפוש הזה." : "אין כרגע הזמנות מקובצות למשלוחים."}</EmptyState>
      ) : (
        <SearchTermsProvider terms={found?.search.terms ?? null}>
        <ResponsiveDataView
          breakpoint="xl"
          desktop={
            // A column table per region, stacked south → center → north.
            // Mobile keeps the richer stop cards below. DataTableShell's frame
            // and head, by hand for the per-region bodies, and the orders
            // table's px-4 py-4 cells (owner, 2026-10-11: one table density).
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
                          const displayAddress = formatDeliveryAddress({ address: group.address, city, unit: group.addressUnit });
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
                              <td className="px-4 py-4">
                                <div className="font-medium"><Painted text={combinedCustomerName(group)} /></div>
                                {/* The number as text and the app's one call look beside
                                    it, the green phone (owner, 2026-10-11: "make them
                                    all the same"). It copies the number at a desk. */}
                                {group.customerPhone ? (
                                  <div className="mt-1 flex items-center gap-2">
                                    <span dir="ltr" className="text-xs text-muted-foreground">
                                      {group.customerPhone}
                                    </span>
                                    <CallIconButton phone={group.customerPhone} name={combinedCustomerName(group)} />
                                  </div>
                                ) : null}
                              </td>
                              <td className="whitespace-nowrap px-4 py-4">
                                <span className="inline-flex items-center gap-1.5">
                                  {/* The city's colour (lib/deliveries/city-colours.ts) — just the
                                      dot here: at a desk nobody is driving the run. */}
                                  <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: cityColour(city) }} />
                                  {city}
                                </span>
                              </td>
                              <td className="px-4 py-4">
                                <div className="flex items-center gap-2">
                                  {/* The icon alone (owner, 2026-10-11: "remove the word waze …
                                      leave just the icon") — the Waze glyph says it, as on the phone.
                                      A saved point goes there, with no word for it either (owner,
                                      2026-10-21: "take away the word נקודה"); grey when the address
                                      isn't a full one: no Waze (components/ui/address-link.tsx). */}
                                  <AddressLink
                                    address={group.address}
                                    city={city}
                                    pin={groupPin}
                                    notFound={group.addressNotFound}
                                    aria-label={groupPin ? "נווט לנקודה השמורה" : "נווט עם Waze"}
                                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground no-underline hover:!text-secondary-foreground hover:!no-underline"
                                    unavailableClassName={NO_ADDRESS_WAZE}
                                  >
                                    <WazeIcon className="h-4 w-4" />
                                  </AddressLink>
                                  <span className="min-w-0">{displayAddress || "—"}</span>
                                </div>
                              </td>
                              <td className="px-4 py-4">
                                <div className="flex flex-wrap items-center gap-1 text-xs">
                                  {partiallyDelivered ? (
                                    <span className={cn("rounded-full border border-warning bg-warning-soft text-warning-soft-foreground", LIST_CARD_BADGE, "font-semibold")}>
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
                                <DeliveryComments notes={delivery.notes} className="mt-2" />
                              </td>
                              <td className="px-4 py-4">
                                <div className="space-y-1">
                                  <div className="font-semibold"><Painted text={formatCurrency(delivery.totalAmount)} /></div>
                                  <div className="flex flex-wrap gap-1">
                                    <RequestedDeliveryDateBadge date={delivery.requestedDeliveryDate} />
                                    <LowStockBadge outOfStock={delivery.outOfStock} />
                                    {unpaidPrepayment ? (
                                      <span
                                        className={`rounded-full px-2 py-0.5 text-[0.647rem] font-semibold ${prepaymentBadgeClasses}`}
                                      >
                                        תשלום מראש — לא נגבה
                                      </span>
                                    ) : null}
                                    <span
                                      className={`rounded-full border px-2 py-0.5 text-[0.647rem] font-medium ${paymentStatusClasses(delivery.paymentStatus)}`}
                                    >
                                      {getPaymentStatusLabel(delivery.paymentStatus)}
                                    </span>
                                    {delivery.collectOnDelivery ? (
                                      <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-[0.647rem] font-semibold text-warning-soft-foreground">
                                        <CashIcon className="h-3.5 w-3.5 shrink-0" />
                                        גבייה במסירה
                                      </span>
                                    ) : null}
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-4">
                                <div className="flex items-center gap-2">
                                  <DeliveryShareActions
                                    delivery={delivery}
                                    label="שליחה לנהג"
                                    variant="outline"
                                    className="shrink-0 gap-1.5"
                                    canEditAddress={canOpenOrder}
                                  />
                                  {/* ✓ אישור אספקה, the dialog's own name for it, in
                                      the list's outline (owner, 2026-08-18: a list
                                      isn't a column of blue blocks). */}
                                  <OrderConfirmDialog
                                    orderId={delivery.id}
                                    customerName={delivery.customerName}
                                    buttonClassName="gap-1.5"
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
                          <h3 className="flex min-w-0 items-center gap-2 text-base font-bold">
                            <span aria-hidden className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: cityColour(city) }} />
                            <span>{city}</span>
                          </h3>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {customerGroups.length} עצירות
                          </span>
                        </div>

                        <ul className="space-y-2">
                            {customerGroups.map(([customerKey, group]) => {
                              const displayAddress = formatDeliveryAddress({ address: group.address, city, unit: group.addressUnit });

                              const hasMultipleOrders = group.orders.length > 1;
                              const groupPin = pinFrom(group.deliveryLat, group.deliveryLng);

                              return (
                                <li key={customerKey}>
                                  <div className="relative overflow-hidden rounded-card border border-border bg-card ps-1.5 shadow-card">
                                    {/* The city's colour down the start edge — fixed per city
                                        (lib/deliveries/city-colours.ts), so a driver sees where
                                        one city's stops end. */}
                                    <span aria-hidden className="absolute inset-y-0 start-0 w-1.5" style={{ backgroundColor: cityColour(city) }} />
                                    {/* The customer leads and the address is the line
                                        under it, as on every list card (owner, 2026-10-11:
                                        "name first"; components/ui/list-card.ts) — the stop
                                        led with the address before. Waze sits opposite as
                                        the one navigation affordance. */}
                                    <div className={cn("flex items-start gap-3", LIST_CARD_BODY)}>
                                      {/* A saved pin beats the address string — it's what
                                          stops Waze dropping the driver at the wrong
                                          entrance or the far side of a divided road. The
                                          same Waze mark either way, no word under it
                                          (owner, 2026-10-21: "take away the word נקודה"). */}
                                      <AddressLink
                                        address={group.address}
                                        city={city}
                                        pin={groupPin}
                                        notFound={group.addressNotFound}
                                        aria-label={groupPin ? "נווט לנקודה השמורה" : "נווט עם Waze"}
                                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-secondary-foreground no-underline hover:!text-secondary-foreground hover:!no-underline"
                                        unavailableClassName={NO_ADDRESS_WAZE}
                                      >
                                        <WazeIcon className="h-5 w-5" />
                                      </AddressLink>
                                      <div className="min-w-0 flex-1">
                                        <div className={LIST_CARD_NAME}><Painted text={combinedCustomerName(group)} /></div>
                                        {displayAddress ? <div className={LIST_CARD_META}>{displayAddress}</div> : null}
                                        {hasMultipleOrders ? (
                                          <span className={cn("mt-1 inline-flex rounded-full border border-border bg-muted/50 text-muted-foreground", LIST_CARD_BADGE)}>
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
                                          {/* The app's one call look (contact-link.tsx). */}
                                          <CallGlyph />
                                          <span className="min-w-0 flex-1">
                                            <span className="block text-sm font-semibold">
                                              <Painted text={combinedCustomerName(group)} />
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
                                    {group.orders.map((delivery) => {
                                      const unpaidPrepayment =
                                        delivery.requiresPrepayment && delivery.paymentStatus !== "paid";
                                      const partiallyDelivered = delivery.status === "partially_delivered";
                                      return (
                                      <div
                                        key={delivery.id}
                                        data-focus-id={delivery.id}
                                        {...(canOpenOrder ? rowNavigateProps(router, `/sales/orders/${delivery.id}`) : {})}
                                        className={`relative border-t border-border/60 ${canOpenOrder ? "cursor-pointer" : ""} ${
                                          unpaidPrepayment ? PREPAYMENT_ROW_CLASSES : ""
                                        }`}
                                      >
                                        <div className="divide-y divide-border/60">
                                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 p-3">
                                          <span className="text-sm font-bold">
                                            <Painted text={formatCurrency(delivery.totalAmount)} />
                                          </span>
                                          <RequestedDeliveryDateBadge date={delivery.requestedDeliveryDate} />
                                          <LowStockBadge outOfStock={delivery.outOfStock} />
                                          {/* Pay-ahead customer, still owing: do NOT hand over
                                              the goods before it's paid. */}
                                          {/* Every list card's pill (LIST_CARD_BADGE); the
                                              ones that warn keep their heavier weight. */}
                                          {unpaidPrepayment ? (
                                            <span className={cn("rounded-full", LIST_CARD_BADGE, "font-semibold", prepaymentBadgeClasses)}>
                                              תשלום מראש — לא נגבה
                                            </span>
                                          ) : null}
                                          <span
                                            className={cn("rounded-full border", LIST_CARD_BADGE, paymentStatusClasses(delivery.paymentStatus))}
                                          >
                                            {getPaymentStatusLabel(delivery.paymentStatus)}
                                          </span>
                                          {/* The one thing the driver must not miss. */}
                                          {delivery.collectOnDelivery ? (
                                            <span
                                              className={cn(
                                                "inline-flex items-center gap-1 rounded-full bg-warning-soft text-warning-soft-foreground",
                                                LIST_CARD_BADGE,
                                                "font-semibold"
                                              )}
                                            >
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
                                              <span className={cn("rounded-full border border-warning bg-warning-soft text-warning-soft-foreground", LIST_CARD_BADGE, "font-semibold")}>
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

                                        {/* The order's comments, under what's on the load
                                            (nothing at all when it has none). */}
                                        <DeliveryComments notes={delivery.notes} className="p-3" />

                                        {/* The delivery's two acts, side by side in the bottom
                                            corner: send it to the driver (a labelled button —
                                            owner, 2026-10-10: the bare share icon in the card's
                                            corner was easy to miss) and ✓ אישור אספקה, the
                                            dialog's own name for it. Both outline, as on every
                                            list (owner, 2026-08-18). Each order on a stop has
                                            its own pair. They wrap, the second under the
                                            first, when a bigger text size makes the pair wider
                                            than the card — side by side they ran past its edge
                                            and the second was cut off. */}
                                        <div className="flex flex-wrap items-center justify-end gap-2 p-3">
                                          <DeliveryShareActions
                                            delivery={delivery}
                                            label="שליחה לנהג"
                                            variant="outline"
                                            className="gap-1.5"
                                            canEditAddress={canOpenOrder}
                                          />
                                          <OrderConfirmDialog
                                            orderId={delivery.id}
                                            customerName={delivery.customerName}
                                            buttonClassName="gap-1.5"
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
        </SearchTermsProvider>
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

// The open deliveries as the route planner's stops: one stop per customer (and
// branch), as the deliveries list groups them — two orders for the same door
// are one stop.

import { combinedCustomerName, type DeliveryItem } from "@/app/(app)/sales/loadDeliveries";
import { pinFrom } from "@/lib/delivery-location";
import { formatDeliveryAddress, getCityRegion } from "@/lib/ui/cities";

export type PlannerStop = {
  key: string;
  /** A delivery from the list, or an address added for this route only. */
  kind: "delivery" | "extra";
  name: string;
  phone: string | null;
  city: string;
  /** What the driver reads: "הרצל 5 · דירה 3". */
  address: string;
  /** Where the route goes: the saved drop-off point, else Google's point of a full address. */
  lat: number | null;
  lng: number | null;
  /** The saved address was marked not found on Google. */
  notFound: boolean;
  customerId: string | null;
  orderIds: string[];
  collectOnDelivery: boolean;
  /** The earliest day a customer asked for. */
  requestedDate: string | null;
  /** What an added stop is for ("איסוף סחורה"). */
  note: string | null;
};

/** The list's own order: south, centre, north, then unknown; cities A–Z; then as listed. */
const REGION_ORDER = ["דרום", "מרכז", "צפון"];

export function plannerStops(deliveries: DeliveryItem[]): PlannerStop[] {
  const byKey = new Map<string, PlannerStop>();
  for (const delivery of deliveries) {
    const key = delivery.customerId
      ? `${delivery.customerId}:${delivery.branchId ?? ""}`
      : `${delivery.customerName}|${delivery.address}|${delivery.customerPhone ?? ""}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.orderIds.push(delivery.id);
      existing.collectOnDelivery ||= delivery.collectOnDelivery;
      if (delivery.requestedDeliveryDate && (!existing.requestedDate || delivery.requestedDeliveryDate < existing.requestedDate)) {
        existing.requestedDate = delivery.requestedDeliveryDate;
      }
      continue;
    }
    const pin = pinFrom(delivery.deliveryLat, delivery.deliveryLng);
    byKey.set(key, {
      key,
      kind: "delivery",
      name: combinedCustomerName(delivery),
      phone: delivery.customerPhone,
      city: delivery.city,
      address: formatDeliveryAddress({ address: delivery.address, city: delivery.city, unit: delivery.addressUnit }),
      lat: pin?.lat ?? null,
      lng: pin?.lng ?? null,
      notFound: delivery.addressNotFound === true,
      customerId: delivery.customerId || null,
      orderIds: [delivery.id],
      collectOnDelivery: delivery.collectOnDelivery,
      requestedDate: delivery.requestedDeliveryDate,
      note: null,
    });
  }
  const rank = (city: string) => {
    const at = REGION_ORDER.indexOf(getCityRegion(city) ?? "");
    return at < 0 ? REGION_ORDER.length : at;
  };
  return Array.from(byKey.values())
    .map((stop, index) => ({ stop, index }))
    .sort((a, b) => rank(a.stop.city) - rank(b.stop.city) || a.stop.city.localeCompare(b.stop.city, "he") || a.index - b.index)
    .map(({ stop }) => stop);
}

/** A stop the route can go to: it has a point on the map. */
export function isRoutable(stop: PlannerStop): boolean {
  return stop.lat !== null && stop.lng !== null;
}

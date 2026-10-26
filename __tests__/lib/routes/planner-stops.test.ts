import { describe, expect, it } from "vitest";
import type { DeliveryItem } from "@/app/(app)/sales/loadDeliveries";
import { isRoutable, plannerStops } from "@/lib/routes/planner-stops";

// The open deliveries as the route planner's stops: one per door, in the
// list's own order, and only the ones with a point on the map can be routed.

function delivery(overrides: Partial<DeliveryItem>): DeliveryItem {
  return {
    id: "o1",
    customerId: "c1",
    branchId: null,
    orderDate: "2026-10-25",
    status: "draft",
    totalAmount: 100,
    totalPaid: 0,
    paymentStatus: "unpaid",
    collectOnDelivery: false,
    requestedDeliveryDate: null,
    notes: null,
    customerName: "לקוח",
    customerBranchName: null,
    customerPhone: "050-0000000",
    city: "ירושלים",
    address: "הרצל 5",
    items: [],
    outOfStock: false,
    requiresPrepayment: false,
    deliveryInstructions: null,
    deliveryLat: 31.78,
    deliveryLng: 35.2,
    addressNotFound: false,
    addressUnit: null,
    ...overrides,
  };
}

describe("plannerStops", () => {
  it("two orders for the same customer are one stop", () => {
    const stops = plannerStops([
      delivery({ id: "o1", requestedDeliveryDate: "2026-10-29" }),
      delivery({ id: "o2", collectOnDelivery: true, requestedDeliveryDate: "2026-10-27" }),
    ]);
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({ orderIds: ["o1", "o2"], collectOnDelivery: true, requestedDate: "2026-10-27" });
  });

  it("two branches of a customer are two stops", () => {
    const stops = plannerStops([delivery({ id: "o1", branchId: "b1" }), delivery({ id: "o2", branchId: "b2" })]);
    expect(stops.map((s) => s.key)).toEqual(["c1:b1", "c1:b2"]);
  });

  it("in the list's order: south, centre, north, then the rest; cities A–Z", () => {
    const stops = plannerStops([
      delivery({ id: "1", customerId: "a", city: "חיפה" }),
      delivery({ id: "2", customerId: "b", city: "ירושלים" }),
      delivery({ id: "3", customerId: "c", city: "באר שבע" }),
      delivery({ id: "4", customerId: "d", city: "בני ברק" }),
      delivery({ id: "5", customerId: "e", city: "ללא עיר" }),
    ]);
    expect(stops.map((s) => s.city)).toEqual(["באר שבע", "בני ברק", "ירושלים", "חיפה", "ללא עיר"]);
  });

  it("a stop with no point can't be routed, and says whether Google couldn't find it", () => {
    const [noPoint] = plannerStops([delivery({ deliveryLat: null, deliveryLng: null })]);
    expect(isRoutable(noPoint)).toBe(false);
    const [notFound] = plannerStops([delivery({ deliveryLat: null, deliveryLng: null, addressNotFound: true })]);
    expect(notFound.notFound).toBe(true);
    const [withPoint] = plannerStops([delivery({})]);
    expect(isRoutable(withPoint)).toBe(true);
  });
});

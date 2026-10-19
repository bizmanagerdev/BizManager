import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { makeSupabase } from "@/__tests__/mocks/supabase-query-builder";
import { addressPoint, structuredPoint } from "@/lib/address/columns";
import { loadDeliveriesPage } from "@/app/(app)/sales/loadDeliveries";

// Addresses plan B, step 5: Waze goes to Google's own point of a full address
// when no drop-off point is saved — never to a town's middle.

const FULL = { addr_city: "בית שמש", addr_street: "יחזקאל הנביא", addr_house_number: "27", addr_lat: 31.7037704, addr_lng: 34.9863334 };

describe("Google's point of an address", () => {
  it("only for a full address that has its point", () => {
    expect(addressPoint(FULL)).toEqual({ lat: 31.7037704, lng: 34.9863334 });
    expect(addressPoint({ ...FULL, addr_street: null, addr_house_number: null })).toBeNull();
    expect(addressPoint({ ...FULL, addr_house_number: null })).toBeNull();
    expect(addressPoint({ ...FULL, addr_lat: null })).toBeNull();
    expect(addressPoint(null)).toBeNull();
  });

  it("reads a move's ends by their own prefix", () => {
    const move = { origin_city: "ירושלים", origin_street: "צפניה", origin_house_number: "48", origin_lat: 31.79, origin_lng: 35.21 };
    expect(addressPoint(move, "origin")).toEqual({ lat: 31.79, lng: 35.21 });
    expect(addressPoint(move, "destination")).toBeNull();
  });

  it("from a picked address too", () => {
    const picked = { city: "בית שמש", street: "יחזקאל הנביא", houseNumber: "27", unit: "", lat: 31.7, lng: 34.98, placeId: null, formatted: "" };
    expect(structuredPoint(picked)).toEqual({ lat: 31.7, lng: 34.98 });
    expect(structuredPoint({ ...picked, houseNumber: "" })).toBeNull();
  });
});

describe("the deliveries list and the driver's slip", () => {
  const stop = (fields: Record<string, unknown>) => ({
    order_id: "o1",
    customer_id: "c1",
    branch_id: null,
    customer_name: "משכן משה",
    customer_address: "בית שמש | יחזקאל הנביא 27",
    customer_city: "בית שמש",
    branch_address: null,
    order_date: "2026-10-19",
    status: "draft",
    total_amount: 100,
    ...fields,
  });
  const customer = (fields: Record<string, unknown>) => ({
    id: "c1",
    address: "בית שמש | יחזקאל הנביא 27",
    addr_place_id: "ChIJ-yechezkel",
    delivery_lat: null,
    delivery_lng: null,
    ...FULL,
    ...fields,
  });
  async function firstStop(tables: { view: Record<string, unknown>; customer: Record<string, unknown>; branch?: Record<string, unknown> }) {
    const db = makeSupabase({
      delivery_overview_view: { data: [tables.view], error: null },
      customers: { data: [tables.customer], error: null },
      customer_branches: { data: tables.branch ? [tables.branch] : [], error: null },
    });
    const { deliveries } = await loadDeliveriesPage(db as unknown as SupabaseClient, { page: 1, filters: {} as never });
    return deliveries[0];
  }

  it("no saved drop-off point: Waze goes to Google's point", async () => {
    const delivery = await firstStop({ view: stop({}), customer: customer({}) });
    expect(delivery).toMatchObject({ deliveryLat: 31.7037704, deliveryLng: 34.9863334 });
  });

  it("a saved drop-off point still wins", async () => {
    const delivery = await firstStop({ view: stop({}), customer: customer({ delivery_lat: "31.75", delivery_lng: "34.99" }) });
    expect(delivery).toMatchObject({ deliveryLat: 31.75, deliveryLng: 34.99 });
  });

  it("only a city from Google: no point, as before", async () => {
    const delivery = await firstStop({ view: stop({}), customer: customer({ addr_street: null, addr_house_number: null }) });
    expect(delivery).toMatchObject({ deliveryLat: null, deliveryLng: null });
  });

  it("an order to a branch goes to the branch's own point, not the customer's", async () => {
    const delivery = await firstStop({
      view: stop({ branch_id: "b1", branch_address: "ירושלים | צפניה 48" }),
      customer: customer({ delivery_lat: "31.75", delivery_lng: "34.99" }),
      branch: { id: "b1", addr_city: "ירושלים", addr_street: "צפניה", addr_house_number: "48", addr_lat: 31.79, addr_lng: 35.21 },
    });
    expect(delivery).toMatchObject({ deliveryLat: 31.79, deliveryLng: 35.21 });
  });
});

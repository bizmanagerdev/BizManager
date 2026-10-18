import { describe, expect, it } from "vitest";
import { projectRowFrom, type ProjectRowFields } from "@/lib/projects/project-input";
import { deviceProjectBody } from "@/lib/powersync/local-writes";
import type { StructuredAddress } from "@/lib/address/structured";

// A move's from / to, picked from Google like every address (owner,
// 2026-10-16). The project row always goes up whole, so: the picked address
// writes its fields and its line; none picked keeps the line as it was (a
// move saved before the picker); a phone's queued row carries its fields up;
// and a project that isn't a move keeps none.

const FROM: StructuredAddress = {
  city: "ירושלים",
  street: "זכריה הרופא",
  houseNumber: "14",
  unit: "",
  lat: 31.79,
  lng: 35.21,
  placeId: "ChIJ-zecharia-14",
  formatted: "זכריה הרופא 14, ירושלים",
};
const TO: StructuredAddress = { ...FROM, street: "צפניה", houseNumber: "48", placeId: "ChIJ-tzefania-48", formatted: "צפניה 48, ירושלים" };

const base = { customer_id: "c1", name: "הובלה", project_type: "moving", status: "planned", origin_floor: "3", origin_has_elevator: true };
const rowOf = (body: Record<string, unknown>) => {
  const result = projectRowFrom(body);
  if ("error" in result) throw new Error(result.error);
  return result.row;
};

describe("a move's addresses", () => {
  it("the picked from / to write their fields and their lines; the floor and lift stay their own", () => {
    const row = rowOf({ ...base, origin_structured: FROM, destination_structured: TO, origin_address: "ignored" });
    expect(row).toMatchObject({
      origin_address: "זכריה הרופא 14, ירושלים",
      origin_city: "ירושלים",
      origin_street: "זכריה הרופא",
      origin_house_number: "14",
      origin_lat: 31.79,
      origin_place_id: "ChIJ-zecharia-14",
      origin_floor: "3",
      origin_has_elevator: true,
      destination_address: "צפניה 48, ירושלים",
      destination_house_number: "48",
    });
  });

  it("none picked keeps a move's line as it was saved before the picker", () => {
    const row = rowOf({ ...base, origin_structured: null, origin_address: " זכריה הרופא 14 ", destination_structured: null });
    expect(row).toMatchObject({ origin_address: "זכריה הרופא 14", origin_city: null, origin_street: null, destination_address: null });
  });

  it("a project that isn't a move keeps no move address at all", () => {
    const row = rowOf({ ...base, project_type: "construction", origin_structured: FROM, origin_address: "x" });
    expect(row).toMatchObject({ origin_address: null, origin_city: null, origin_lat: null, destination_city: null });
  });

  it("a phone's queued row carries its picked fields up, and they come back the same", () => {
    const row = rowOf({ ...base, origin_structured: FROM, destination_structured: null }) as ProjectRowFields;
    // As the device copy stores it (lat/lng as numbers, flags as 1/0).
    const stored = { ...row, origin_has_elevator: 1, items_to_move: null } as unknown as Record<string, unknown>;
    const body = deviceProjectBody("p1", stored);
    expect(body).not.toHaveProperty("origin_structured");
    expect(rowOf(body)).toMatchObject({ origin_address: "זכריה הרופא 14, ירושלים", origin_place_id: "ChIJ-zecharia-14", origin_lat: 31.79 });
  });
});

// Owner, 2026-10-18: a from / to Google couldn't find is marked, and stays
// marked through an edit of anything else until a real address is picked.
describe("a move end not found on Google Maps", () => {
  const marked = { ...base, origin_structured: null, origin_address: "ביתר | הרב קוק", origin_not_found: true };

  it("an edit that doesn't pick a new one keeps the mark and the old line", () => {
    expect(rowOf(marked)).toMatchObject({ origin_address: "ביתר | הרב קוק", origin_place_id: "not_found", origin_city: null });
    expect(rowOf(marked).destination_place_id).toBeNull();
  });

  it("a picked address replaces it", () => {
    expect(rowOf({ ...marked, origin_structured: FROM })).toMatchObject({ origin_place_id: "ChIJ-zecharia-14", origin_city: "ירושלים" });
  });

  it("a phone's queued row keeps it too", () => {
    const stored = { ...rowOf(marked), origin_has_elevator: 1, items_to_move: null } as unknown as Record<string, unknown>;
    expect(rowOf(deviceProjectBody("p1", stored))).toMatchObject({ origin_place_id: "not_found" });
  });

  it("a project that isn't a move keeps no mark", () => {
    expect(rowOf({ ...marked, project_type: "construction" }).origin_place_id).toBeNull();
  });
});

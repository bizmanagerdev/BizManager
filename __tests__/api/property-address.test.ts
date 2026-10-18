import { describe, it, expect, vi, beforeEach } from "vitest";

// A property's address picked from Google like every address (owner,
// 2026-10-16): the picked one writes its fields and its line (the line is
// what names a property that has no name); one saved before the picker keeps
// its line; and an address is still required.

const inserts: Record<string, unknown>[] = [];
const updates: Record<string, unknown>[] = [];
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireProfile", () => ({
  requireProfile: async () => {
    const builder: Record<string, unknown> = {};
    builder.insert = (row: Record<string, unknown>) => {
      inserts.push(row);
      return builder;
    };
    builder.update = (row: Record<string, unknown>) => {
      updates.push(row);
      return builder;
    };
    builder.select = () => builder;
    builder.eq = () => Promise.resolve({ error: null });
    builder.single = () => Promise.resolve({ data: { id: "p1" }, error: null });
    return { profile: { role: "admin" }, supabase: { from: () => builder } };
  },
}));

import { createProperty, updateProperty } from "@/app/(app)/properties/actions";
import { EMPTY_PROPERTY_FORM } from "@/app/(app)/properties/PropertyFormFields";

const PICKED = {
  city: "ירושלים",
  street: "ריבל",
  houseNumber: "29",
  unit: "דירה 3",
  lat: 31.79,
  lng: 35.21,
  placeId: "ChIJ-rivel-29",
  formatted: "ריבל 29, ירושלים",
};

beforeEach(() => {
  inserts.length = 0;
  updates.length = 0;
});

describe("a property's address", () => {
  it("picked: its fields, and its line with the unit", async () => {
    const result = await createProperty({ ...EMPTY_PROPERTY_FORM, name: "דירה 3", address: "ignored", addr: PICKED });
    expect(result.ok).toBe(true);
    expect(inserts[0]).toMatchObject({
      address: "ריבל 29, ירושלים · דירה 3",
      addr_city: "ירושלים",
      addr_street: "ריבל",
      addr_house_number: "29",
      addr_unit: "דירה 3",
      addr_place_id: "ChIJ-rivel-29",
    });
  });

  it("one saved before the picker keeps its line, its fields empty", async () => {
    await updateProperty("p1", { ...EMPTY_PROPERTY_FORM, name: "דירה", address: " ריבל שמח 29 ", addr: null });
    expect(updates[0]).toMatchObject({ address: "ריבל שמח 29", addr_city: null, addr_street: null });
  });

  it("an address is still required", async () => {
    const result = await createProperty({ ...EMPTY_PROPERTY_FORM, name: "דירה", address: "", addr: null });
    expect(result).toEqual({ ok: false, error: "יש להזין כתובת." });
    expect(inserts).toHaveLength(0);
  });
});

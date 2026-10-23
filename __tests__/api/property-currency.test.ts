import { describe, it, expect, vi, beforeEach } from "vitest";

// A property's currency (owner, 2026-10-23, the Canada buildings): saved with
// it; anything else reads as shekels; a form from before it (an app not yet
// updated) leaves it as it is.

const updates: Record<string, unknown>[] = [];
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireProfile", () => ({
  requireProfile: async () => {
    const builder: Record<string, unknown> = {};
    builder.update = (row: Record<string, unknown>) => {
      updates.push(row);
      return builder;
    };
    builder.eq = () => Promise.resolve({ error: null });
    return { profile: { role: "admin" }, supabase: { from: () => builder } };
  },
}));

import { updateProperty } from "@/app/(app)/properties/actions";
import { EMPTY_PROPERTY_FORM, type PropertyInput } from "@/app/(app)/properties/PropertyFormFields";

beforeEach(() => {
  updates.length = 0;
});

const PLOURDE = { ...EMPTY_PROPERTY_FORM, name: "25 Plourde", address: "25 Plourde Street, Charlemagne" };

describe("a property's currency", () => {
  it("saved with it", async () => {
    expect((await updateProperty("p1", { ...PLOURDE, currency: "CAD", purchase_price: "1200000" })).ok).toBe(true);
    expect(updates[0]).toMatchObject({ currency: "CAD", purchase_price: 1200000 });
  });

  it("a new property is in shekels; anything that isn't a currency reads as shekels", async () => {
    await updateProperty("p1", PLOURDE);
    await updateProperty("p1", { ...PLOURDE, currency: "EUR" });
    expect(updates.map((row) => row.currency)).toEqual(["ILS", "ILS"]);
  });

  it("a form from before it: left as it is", async () => {
    const old: Partial<PropertyInput> = { ...PLOURDE };
    delete old.currency;
    await updateProperty("p1", old as PropertyInput);
    expect(updates[0]).not.toHaveProperty("currency");
  });
});

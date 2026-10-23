import { describe, it, expect, vi, beforeEach } from "vitest";

// A property's management company and owning company (owner, 2026-10-23):
// saved with it, trimmed; and a form from before them (an app not yet
// updated) leaves them as they are rather than emptying them.

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
import {
  EMPTY_PROPERTY_FORM,
  type PropertyInput,
} from "@/app/(app)/properties/PropertyFormFields";

beforeEach(() => {
  updates.length = 0;
});

describe("a property's companies", () => {
  it("saved with it", async () => {
    const result = await updateProperty("p1", {
      ...EMPTY_PROPERTY_FORM,
      name: "25 Plourde",
      address: "25 Plourde Street, Charlemagne",
      rent_managed_by_company: true,
      management_company_name: " Redleaf Management ",
      management_portal_url: "https://redleafmanagement.managebuilding.com",
      owner_company_name: "25 PLOURDE INC.",
      owner_company_number: "1180846645",
      owner_company_type: "Corporation",
      zoning: "מגורים",
      region: " Quebec ",
      tax_account_number: "020874-10",
    });
    expect(result.ok).toBe(true);
    expect(updates[0]).toMatchObject({
      rent_managed_by_company: true,
      management_company_name: "Redleaf Management",
      management_portal_url: "https://redleafmanagement.managebuilding.com",
      management_notes: null,
      owner_company_name: "25 PLOURDE INC.",
      owner_company_number: "1180846645",
      owner_company_type: "Corporation",
      owner_company_url: null,
      zoning: "מגורים",
      region: "Quebec",
      tax_account_number: "020874-10",
    });
  });

  it("a form from before them: left as they are", async () => {
    const old: Partial<PropertyInput> = {
      ...EMPTY_PROPERTY_FORM,
      name: "25 Plourde",
      address: "25 Plourde Street",
    };
    for (const key of Object.keys(old) as (keyof PropertyInput)[]) {
      if (
        key === "rent_managed_by_company" ||
        key.startsWith("management_") ||
        key.startsWith("owner_company_") ||
        key === "zoning" ||
        key === "region" ||
        key === "tax_account_number"
      )
        delete old[key];
    }
    const result = await updateProperty("p1", old as PropertyInput);
    expect(result.ok).toBe(true);
    expect(
      Object.keys(updates[0]).filter(
        (k) =>
          k.includes("company") ||
          k.startsWith("management_") ||
          ["zoning", "region", "tax_account_number"].includes(k),
      ),
    ).toEqual([]);
  });
});

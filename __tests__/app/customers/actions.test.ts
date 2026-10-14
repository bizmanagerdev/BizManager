import { beforeEach, describe, expect, it, vi } from "vitest";

// The customers list's server actions: each signs the caller in again, takes
// only what a filter or an id can be, and hands a failed read back as an
// error the list can show (with "נסו שוב") — not as an empty page that
// quietly ended the list.

const { requireProfile, loader } = vi.hoisted(() => ({
  requireProfile: vi.fn(),
  loader: {
    loadCustomersPage: vi.fn(),
    loadCustomersByIds: vi.fn(),
    loadCustomerIdsPassingFilters: vi.fn(),
  },
}));
vi.mock("@/lib/auth/requireProfile", () => ({ requireProfile }));
vi.mock("@/app/(app)/customers/loadCustomers", () => loader);

import { findCustomerIdsPassingFilters, loadCustomerRowsByIds, loadMoreCustomers } from "@/app/(app)/customers/actions";
import { NO_CUSTOMERS_FILTERS } from "@/app/(app)/customers/customersFilters";

const supabase = { tag: "supabase" };

beforeEach(() => {
  vi.clearAllMocks();
  requireProfile.mockResolvedValue({ supabase, profile: { role: "office" } });
});

describe("loadMoreCustomers", () => {
  it("passes a failed read on as an error", async () => {
    loader.loadCustomersPage.mockResolvedValue({ rows: [], totalCount: 0, hasMore: false, error: "אירעה שגיאה. נסו שוב." });
    expect(await loadMoreCustomers(2, NO_CUSTOMERS_FILTERS)).toEqual({ rows: [], hasMore: false, error: "אירעה שגיאה. נסו שוב." });
    expect(requireProfile).toHaveBeenCalled();
    expect(loader.loadCustomersPage).toHaveBeenCalledWith(supabase, { page: 2, filters: NO_CUSTOMERS_FILTERS });
  });

  it("reads anything that isn't a filter as 'all'", async () => {
    loader.loadCustomersPage.mockResolvedValue({ rows: [], totalCount: 0, hasMore: false, error: null });
    await loadMoreCustomers(3, { withDebt: "yes", withOrders: "drop table", activeOnly: 7 });
    expect(loader.loadCustomersPage).toHaveBeenCalledWith(supabase, {
      page: 3,
      filters: { ...NO_CUSTOMERS_FILTERS, withDebt: "yes" },
    });
  });
});

describe("loadCustomerRowsByIds", () => {
  it("drops what isn't an id, and filters only when asked", async () => {
    loader.loadCustomersByIds.mockResolvedValue({ rows: [{ customer_id: "c1" }], error: null });
    const result = await loadCustomerRowsByIds(["c1", "", 5 as unknown as string]);
    expect(result).toEqual({ rows: [{ customer_id: "c1" }], error: null });
    expect(loader.loadCustomersByIds).toHaveBeenCalledWith(supabase, ["c1"], undefined);

    await loadCustomerRowsByIds(["c1"], { withProjects: "no" });
    expect(loader.loadCustomersByIds).toHaveBeenLastCalledWith(supabase, ["c1"], { ...NO_CUSTOMERS_FILTERS, withProjects: "no" });
  });
});

describe("findCustomerIdsPassingFilters", () => {
  it("checks the matches against the filters on the server", async () => {
    loader.loadCustomerIdsPassingFilters.mockResolvedValue({ ids: ["b"], error: null });
    expect(await findCustomerIdsPassingFilters(["a", "b"], { withDebt: "yes" })).toEqual({ ids: ["b"], error: null });
    expect(loader.loadCustomerIdsPassingFilters).toHaveBeenCalledWith(supabase, ["a", "b"], {
      ...NO_CUSTOMERS_FILTERS,
      withDebt: "yes",
    });
  });

  it("caps a hand-made list of ids", async () => {
    loader.loadCustomerIdsPassingFilters.mockResolvedValue({ ids: [], error: null });
    await findCustomerIdsPassingFilters(Array.from({ length: 6000 }, (_, i) => `c${i}`), {});
    expect(loader.loadCustomerIdsPassingFilters.mock.calls[0][1]).toHaveLength(5000);
  });
});

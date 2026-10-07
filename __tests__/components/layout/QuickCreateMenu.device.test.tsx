// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

// The + menu's lists for admins and office come from the on-device copy —
// worked out with the server's own loader, no request to the server — and
// from the server when the copy can't serve them (or for anyone else).

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard", useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/offline-cache", () => ({ loadSnapshot: async () => null, saveSnapshot: async () => {}, deleteSnapshot: async () => {} }));

const device = vi.hoisted(() => ({ db: { name: "device" } as unknown }));
vi.mock("@/lib/powersync/store", () => ({
  readyLocalDatabase: () => device.db,
  whenLocalDatabaseReady: async () => device.db,
}));
vi.mock("@/lib/powersync/local-supabase", () => ({ createLocalSupabase: (db: unknown) => ({ local: db }) }));
const loader = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@/app/(app)/dashboard/quick-actions-data", () => ({ loadQuickActionsData: loader.fn }));

const lists = {
  customers: [], taskCustomers: [{ id: "c1", label: "לקוח" }], products: [], projects: [], orders: [], properties: [],
  users: [{ id: "u1", label: "מנהל", role: "admin" }], salaryAgreements: [],
};

/** Mounts the menu; its warm-up runs once the page is idle (a moment later). */
async function warmUp(role: string) {
  vi.resetModules();
  const { QuickCreateMenu } = await import("@/components/layout/QuickCreateMenu");
  render(<QuickCreateMenu viewerId="u1" viewerRole={role} variant="fab" />);
}

const soon = { timeout: 5000 };

describe("the + menu's lists", () => {
  beforeEach(() => {
    loader.fn.mockReset();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ...lists, currentUserId: "u1", role: "admin", locale: "he" }), { status: 200 })));
  });

  it("admins and office: from the device copy, without asking the server", async () => {
    loader.fn.mockResolvedValue(lists);
    await warmUp("admin");
    await waitFor(() => expect(loader.fn).toHaveBeenCalledWith({ local: device.db }, { strict: true }), soon);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetch).not.toHaveBeenCalledWith("/api/quick-actions/data", expect.anything());
  });

  it("the copy can't serve them: the server, as before", async () => {
    loader.fn.mockRejectedValue(new Error("Column x isn't available on the device"));
    await warmUp("office");
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/quick-actions/data", expect.anything()), soon);
  });

  it("anyone else (a worker): the server", async () => {
    await warmUp("worker");
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/quick-actions/data", expect.anything()), soon);
    expect(loader.fn).not.toHaveBeenCalled();
  });
});

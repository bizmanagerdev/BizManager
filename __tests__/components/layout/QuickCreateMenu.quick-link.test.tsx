// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

// The phone app's long-press shortcuts (APK 1.2) open /dashboard?quick=task or
// ?quick=order: the + menu opens that form at once, as if its tile was tapped,
// and the value leaves the address.

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard", useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/offline-cache", () => ({ loadSnapshot: async () => null, saveSnapshot: async () => {}, deleteSnapshot: async () => {} }));
// The dialog host, reduced to which form it was asked to open.
vi.mock("@/components/layout/QuickCreateDialogs", () => ({
  default: ({ action }: { action: string | null }) => <div data-testid="quick-form">{action ?? "none"}</div>,
}));
vi.mock("@/components/expenses/ExpenseDialog", () => ({ ExpenseDialog: () => null }));
vi.mock("@/components/tasks/TaskUpsertDialog", () => ({ default: () => null, TaskUpsertDialog: () => null }));
vi.mock("@/lib/powersync/store", () => ({
  readyLocalDatabase: () => null,
  whenLocalDatabaseReady: async () => null,
  useLocalViewer: () => null,
}));

async function openWith(url: string, role: string) {
  window.history.replaceState(null, "", url);
  vi.resetModules();
  const { QuickCreateMenu } = await import("@/components/layout/QuickCreateMenu");
  render(<QuickCreateMenu viewerId="u1" viewerRole={role} variant="desktopFab" />);
}

describe("?quick= links open a + menu form", () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ customers: [], users: [], currentUserId: "u1", role: "admin", locale: "he" }), { status: 200 }))
    );
  });

  it("?quick=order opens the new order, and leaves the address", async () => {
    await openWith("/dashboard?quick=order", "admin");
    await waitFor(() => expect(screen.getByTestId("quick-form").textContent).toBe("order"), { timeout: 8000 });
    expect(window.location.search).toBe("");
  });

  it("?quick=task opens the new task", async () => {
    await openWith("/dashboard?quick=task", "office");
    await waitFor(() => expect(screen.getByTestId("quick-form").textContent).toBe("task"), { timeout: 8000 });
  });

  it("?quick=expense opens the new expense (the הוצאה חדשה shortcut)", async () => {
    await openWith("/dashboard?quick=expense", "admin");
    await waitFor(() => expect(screen.getByTestId("quick-form").textContent).toBe("expense"), { timeout: 8000 });
  });

  it("a worker's ?quick=order opens a task instead (an order isn't his to create)", async () => {
    await openWith("/dashboard?quick=order", "worker");
    await waitFor(() => expect(screen.getByTestId("quick-form").textContent).toBe("task"), { timeout: 8000 });
  });

  it("?quick=search is left for the search box", async () => {
    await openWith("/dashboard?quick=search", "admin");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.queryByTestId("quick-form")).toBeNull();
    expect(window.location.search).toBe("?quick=search");
  });
});

// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";

// The device version of a project's page: the project from the device copy at
// once, what only the server reads filling in as it comes; a project the copy
// doesn't hold yet waits a little, then the server version; and the moment a
// row is tapped (or the page is loading) the page itself from the copy, with
// the person's own תנועות view as the server last gave it.

const nav = vi.hoisted(() => {
  const replace = vi.fn();
  return { replace, router: { replace } };
});
vi.mock("next/navigation", () => ({ useRouter: () => nav.router }));

const newDb = () => ({ get: async () => ({ n: 3 }), getAll: async () => [], onChange: () => () => {} });
const device = vi.hoisted(() => ({
  db: null as unknown,
  status: { hasSynced: true } as { hasSynced: boolean } | null,
  viewer: null as { id: string; role: string; locale: "he"; name: string | null } | null,
}));
vi.mock("@/lib/powersync/store", () => ({
  useLocalDatabase: () => device.db,
  useLocalSyncStatus: () => device.status,
  useLocalViewer: () => device.viewer,
}));
vi.mock("@/lib/sentry-lazy", () => ({ withSentry: () => {} }));

const computeLocalCard = vi.hoisted(() => vi.fn());
vi.mock("@/lib/powersync/dashboard-local", () => ({ computeLocalCard, LOCAL_CARD_TABLES: { projectPage: ["projects"] } }));
vi.mock("@/lib/powersync/local-supabase", () => ({ createLocalSupabase: () => ({}), LOCAL_TABLES: new Set(["projects"]) }));

vi.mock("@/app/(app)/projects/[id]/ProjectPageView", () => ({
  default: function View(props: {
    id: string;
    core: { dashboardRow: { name: string } | null };
    extras: { activity: unknown[] | null } | null;
    viewer: { ledgerPrefs: { groupBy: string } };
  }) {
    return (
      <div>
        <span>project {props.id}: {props.core.dashboardRow?.name}</span>
        <span>{props.extras ? `history: ${props.extras.activity?.length ?? 0}` : "history on its way"}</span>
        <span>grouped by {props.viewer.ledgerPrefs.groupBy}</span>
      </div>
    );
  },
}));
vi.mock("@/app/(app)/projects/[id]/ProjectPagePreview", () => ({
  default: ({ preview }: { preview: { name: string } }) => <span>preview of {preview.name}</span>,
}));
vi.mock("@/app/(app)/projects/[id]/ProjectPageSkeleton", () => ({ default: () => <span>grey blocks</span> }));

import LocalProjectPage from "@/app/(app)/projects/[id]/LocalProjectPage";
import ProjectPageOpening from "@/app/(app)/projects/[id]/ProjectPageOpening";

const viewer = { userId: "2fcc692e-5bd7-41a1-b4c4-3aabfa7d580e", role: "admin", locale: "he" as const };
const preview = { id: "p1", name: "הובלה לחיפה", customerId: null, customerName: null, customerPhone: null } as never;
const core = (id: string, name: string | null) => ({ filters: { id }, dashboardRow: name ? { name } : null, expenses: [] });

describe("LocalProjectPage", () => {
  beforeEach(() => {
    localStorage.clear();
    device.db = newDb();
    device.status = { hasSynced: true };
    device.viewer = null;
    nav.replace.mockReset();
    computeLocalCard.mockReset();
  });
  afterEach(() => {
    cleanup();
  });

  it("the project from the device at once; the server's parts fill in; the person's view remembered for next time", async () => {
    computeLocalCard.mockImplementation(async (_l, _k, _v, filters: { id: string }) => core(filters.id, "הובלה"));
    let deliver: (value: { activity: unknown[] }) => void = () => {};
    const extras = new Promise<{ activity: unknown[] }>((resolve) => (deliver = resolve));
    render(<LocalProjectPage id="p1" viewer={{ ...viewer, ledgerPrefs: { groupBy: "employee", sortBy: "date", sortDirection: "desc" } }} extras={extras as never} />);

    expect(await screen.findByText("project p1: הובלה")).toBeTruthy();
    expect(screen.getByText("history on its way")).toBeTruthy();
    expect(computeLocalCard).toHaveBeenCalledWith(expect.anything(), "projectPage", { userId: viewer.userId, role: "admin", locale: "he" }, { id: "p1" });
    await act(async () => deliver({ activity: [{}, {}] }));
    expect(screen.getByText("history: 2")).toBeTruthy();
    expect(localStorage.getItem("bizh-ledger-prefs")).toContain("employee");
  });

  it("a project the copy doesn't hold yet: waits for it a moment, then the server version", async () => {
    computeLocalCard.mockImplementation(async (_l, _k, _v, filters: { id: string }) => core(filters.id, null));
    render(<LocalProjectPage id="p9" viewer={{ ...viewer, ledgerPrefs: { groupBy: "none", sortBy: "date", sortDirection: "desc" } }} extras={null} />);
    await waitFor(() => expect(computeLocalCard).toHaveBeenCalled());
    expect(screen.getByText("grey blocks")).toBeTruthy();
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/projects/p9?data=server"), { timeout: 4000 });
  });
});

describe("ProjectPageOpening (a tapped row, the loading screen)", () => {
  beforeEach(() => {
    localStorage.clear();
    device.db = newDb();
    device.status = { hasSynced: true };
    nav.replace.mockReset();
    computeLocalCard.mockReset();
    computeLocalCard.mockImplementation(async (_l, _k, _v, filters: { id: string }) => core(filters.id, "הובלה"));
  });
  afterEach(cleanup);

  it("the page itself from the copy, in the person's own view as the server last gave it", async () => {
    localStorage.setItem("bizh-ledger-prefs", JSON.stringify({ u: viewer.userId, p: { groupBy: "category", sortBy: "date", sortDirection: "desc" } }));
    device.viewer = { id: viewer.userId, role: "admin", locale: "he", name: "דנה" };
    render(<ProjectPageOpening id="p1" preview={preview} />);
    expect(await screen.findByText("project p1: הובלה")).toBeTruthy();
    expect(screen.getByText("grouped by category")).toBeTruthy();
  });

  it("not for someone the page isn't switched on for yet: the header from the row", () => {
    device.viewer = { id: "someone-else", role: "admin", locale: "he", name: null };
    render(<ProjectPageOpening id="p1" preview={preview} />);
    expect(screen.getByText("preview of הובלה לחיפה")).toBeTruthy();
    expect(computeLocalCard).not.toHaveBeenCalled();
  });
});

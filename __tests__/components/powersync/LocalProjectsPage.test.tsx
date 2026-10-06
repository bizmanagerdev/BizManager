// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

// The device version of /projects: the list, the tab counts and the dialog's
// lists from the device; another tab and the next page from the device too;
// searches from the server; the server version when the copy can't serve it.

const nav = vi.hoisted(() => {
  const replace = vi.fn();
  return { replace, router: { replace }, search: "view=projects" };
});
vi.mock("next/navigation", () => ({
  useRouter: () => nav.router,
  useSearchParams: () => new URLSearchParams(nav.search),
}));

// One database object for the page's life, like the real store's — a fresh
// one per test (beforeEach), like a fresh sign-in: nothing kept from the last test.
const newDb = () => ({ get: async () => ({ n: 3 }), getAll: async () => [], onChange: () => () => {} });
const device = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/powersync/store", () => ({
  useLocalDatabase: () => device.db,
  useLocalSyncStatus: () => ({ hasSynced: true }),
}));
vi.mock("@/lib/sentry-lazy", () => ({ withSentry: () => {} }));

const computeLocalCard = vi.hoisted(() => vi.fn());
const computeLocalListPage = vi.hoisted(() => vi.fn());
vi.mock("@/lib/powersync/dashboard-local", () => ({
  computeLocalCard,
  computeLocalListPage,
  LOCAL_CARD_TABLES: { projectsList: ["projects"], projectsExtras: ["projects"] },
}));
vi.mock("@/lib/powersync/local-supabase", () => ({ createLocalSupabase: () => ({}), LOCAL_TABLES: new Set(["projects"]) }));

const server = vi.hoisted(() => ({ firstPage: vi.fn(), loadMore: vi.fn() }));
vi.mock("@/app/(app)/projects/projectsListCache", () => ({ fetchProjectsFirstPageFromServer: server.firstPage }));
vi.mock("@/app/(app)/projects/actions", () => ({ loadMoreProjects: server.loadMore }));

// The list is the server version's component; here it shows what it was given
// and asks its list source for other lists the way it does when you switch
// tabs, scroll, or search.
vi.mock("@/app/(app)/projects/ProjectsClient", async () => {
  const { useProjectsListSource } = await import("@/app/(app)/projects/ProjectsListSource");
  const { useState } = await import("react");
  const base = { view: "projects", status: "all", customerId: null, sort: "start_date_desc", q: "" } as const;
  return {
    default: function Projects(props: {
      initialProjects: Array<{ id: string }>;
      tabCounts: { quotes: number };
      managerOptions: Array<{ label: string }>;
      totalCount: number;
    }) {
      const source = useProjectsListSource();
      const [extra, setExtra] = useState<string[]>([]);
      const show = (rows: Array<Record<string, unknown>> | undefined) => setExtra((rows ?? []).map((r) => String(r.id)));
      return (
        <div>
          <span>quotes: {props.tabCounts.quotes}</span>
          <span>managers: {props.managerOptions.map((m) => m.label).join(",")}</span>
          <span>total: {props.totalCount}</span>
          <ul>
            {[...props.initialProjects.map((p) => p.id), ...extra].map((id) => (
              <li key={id}>{id}</li>
            ))}
          </ul>
          <button onClick={() => void source?.firstPage({ ...base, view: "quotes" }).then((p) => show(p?.rows))}>quotes</button>
          <button onClick={() => void source?.page(2, base).then((p) => show(p.rows))}>more</button>
          <button onClick={() => void source?.firstPage({ ...base, q: "דנה" }).then((p) => show(p?.rows))}>search</button>
        </div>
      );
    },
  };
});

import LocalProjectsPage from "@/app/(app)/projects/LocalProjectsPage";

const viewer = { userId: "me", role: "admin", locale: "he" as const };
const shown = () => screen.queryAllByRole("listitem").map((li) => li.textContent);

describe("LocalProjectsPage", () => {
  beforeEach(() => {
    localStorage.clear(); // a fresh device: nothing stored from the last test
    device.db = newDb();
    nav.replace.mockReset();
    computeLocalCard.mockReset();
    computeLocalListPage.mockReset();
    server.firstPage.mockReset();
    server.loadMore.mockReset();
  });

  it("the list, counts and lists from the device; another tab and page 2 from the device; a search from the server", async () => {
    computeLocalCard.mockImplementation(async (_local, kind, _viewer, filters) =>
      kind === "projectsExtras"
        ? {
            filters,
            tabCounts: { projects: 2, quotes: 4, closed: 9 },
            options: { customerOptions: [], managerOptions: [{ id: "u1", label: "משה" }], defaultProjectManagerId: "u1" },
          }
        : { filters, rows: [{ id: filters.view === "quotes" ? "q1" : "p1" }], hasMore: true, totalCount: 51 }
    );
    computeLocalListPage.mockResolvedValue({ rows: [{ id: "p2" }], hasMore: false });
    server.firstPage.mockResolvedValue({ rows: [{ id: "found" }], hasMore: false, totalCount: 1 });
    render(<LocalProjectsPage viewer={viewer} customerName={null} />);

    expect(await screen.findByText("quotes: 4")).toBeTruthy();
    expect(screen.getByText("managers: משה")).toBeTruthy();
    expect(screen.getByText("total: 51")).toBeTruthy();
    expect(shown()).toEqual(["p1"]);

    await act(async () => fireEvent.click(screen.getByText("quotes")));
    expect(shown()).toEqual(["p1", "q1"]);
    await act(async () => fireEvent.click(screen.getByText("more")));
    expect(shown()).toEqual(["p1", "p2"]);
    expect(computeLocalListPage).toHaveBeenCalledWith(expect.anything(), "projectsList", expect.objectContaining({ view: "projects" }), 2);

    await act(async () => fireEvent.click(screen.getByText("search")));
    expect(shown()).toEqual(["p1", "found"]);
    expect(server.firstPage).toHaveBeenCalledWith(expect.objectContaining({ q: "דנה" }));
  });

  it("goes to the server version when the device can't work it out", async () => {
    computeLocalCard.mockRejectedValue(new Error("boom"));
    render(<LocalProjectsPage viewer={viewer} customerName={null} />);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/projects?view=projects&data=server"));
  });
});

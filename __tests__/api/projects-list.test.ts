import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// Contract tests for GET /api/projects/list — one page of the projects list
// for the filters in the query string. ProjectsClient uses it to switch tabs in
// the browser and to load the other tabs in the background, so it must read the
// URL exactly as the /projects page does (parseProjectsFilters).

const { requireRouteAccess, loadProjectsPage } = vi.hoisted(() => ({
  requireRouteAccess: vi.fn(),
  loadProjectsPage: vi.fn(),
}));

vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));
vi.mock("@/app/(app)/projects/loadProjects", () => ({ loadProjectsPage }));

import { GET } from "@/app/api/projects/list/route";
import {
  parseProjectsFilters,
  projectsFiltersKey,
  projectsFiltersQuery,
} from "@/app/(app)/projects/projectsFilters";

const supabase = {};

function get(query: string) {
  return GET(new Request(`http://test/api/projects/list${query ? `?${query}` : ""}`));
}

beforeEach(() => {
  requireRouteAccess.mockReset().mockResolvedValue({
    ok: true,
    value: { supabase, user: { id: "auth-1" }, profile: { id: "u1", role: "office" } },
  });
  loadProjectsPage.mockReset().mockResolvedValue({ rows: [{ id: "p1" }], totalCount: 1, hasMore: false, error: null });
});

describe("GET /api/projects/list", () => {
  it("is for staff only", async () => {
    await get("");
    expect(requireRouteAccess).toHaveBeenCalledWith({ allowedRoles: ["admin", "office"] });
  });

  it("loads page 1 of the default list when the query is empty", async () => {
    const res = await get("");
    expect(res.status).toBe(200);
    expect(loadProjectsPage).toHaveBeenCalledWith(supabase, {
      page: 1,
      filters: { view: "projects", status: "all", customerId: null, sort: "start_date_desc", q: "" },
    });
    expect(await res.json()).toEqual({ rows: [{ id: "p1" }], hasMore: false, totalCount: 1 });
  });

  it("reads the tab, filters and page from the query", async () => {
    await get("view=closed&status=completed&sort=profit_desc&q=%20abc%20&customer_id=c1&page=2");
    expect(loadProjectsPage).toHaveBeenCalledWith(supabase, {
      page: 2,
      filters: { view: "closed", status: "completed", customerId: "c1", sort: "profit_desc", q: "abc" },
    });
  });

  it("falls back to the defaults for an unknown tab, sort or page", async () => {
    await get("view=nope&sort=nope&page=-3");
    expect(loadProjectsPage).toHaveBeenCalledWith(supabase, {
      page: 1,
      filters: { view: "projects", status: "all", customerId: null, sort: "start_date_desc", q: "" },
    });
  });

  it("reports a failed load as an error, not as an empty list", async () => {
    loadProjectsPage.mockResolvedValue({ rows: [], totalCount: 0, hasMore: false, error: "שגיאה" });
    const res = await get("");
    expect(res.status).toBe(500);
  });

  it("passes a refused caller's response straight through, loading nothing", async () => {
    requireRouteAccess.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "No access" }, { status: 403 }),
    });
    const res = await get("");
    expect(res.status).toBe(403);
    expect(loadProjectsPage).not.toHaveBeenCalled();
  });
});

describe("projects list filters", () => {
  it("round-trips through the query string the client sends", () => {
    const filters = { view: "quotes" as const, status: "quote", customerId: "c9", sort: "recent" as const, q: "שלום" };
    const query = new URLSearchParams(projectsFiltersQuery(filters));
    expect(parseProjectsFilters((key) => query.get(key))).toEqual(filters);
  });

  it("leaves defaults out of the query, so a tab's URL stays as the page writes it", () => {
    expect(projectsFiltersQuery(parseProjectsFilters(() => null))).toBe("");
    expect(projectsFiltersQuery({ ...parseProjectsFilters(() => null), view: "closed" })).toBe("view=closed");
  });

  it("gives each distinct list its own key and the same list the same key", () => {
    const base = parseProjectsFilters(() => null);
    expect(projectsFiltersKey(base)).toBe(projectsFiltersKey(parseProjectsFilters((key) => (key === "sort" ? "start_date_desc" : null))));
    expect(projectsFiltersKey(base)).not.toBe(projectsFiltersKey({ ...base, view: "closed" }));
    expect(projectsFiltersKey(base)).not.toBe(projectsFiltersKey({ ...base, customerId: "c1" }));
  });
});

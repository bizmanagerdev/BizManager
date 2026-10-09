// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";

// The projects list's loading screen is also what the router shows on the way
// to a project's page (owner's report, 2026-10-08: an empty list skeleton
// between the tapped project's preview and its page, and the list's search
// strip folding away when the page came — a layout shift). By the address:
// the list's skeleton holds the strip open; a project's page gets its own
// loading screen, and no strip.

const nav = vi.hoisted(() => ({ pathname: "/projects" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));
vi.mock("@/app/(app)/projects/[id]/ProjectPageLoading", () => ({
  default: ({ id }: { id?: string }) => <div data-testid="project-loading">{id}</div>,
}));
vi.mock("@/app/(app)/projects/[id]/export/ProjectExportSkeleton", () => ({
  default: () => <div data-testid="export-loading" />,
}));

import ProjectsLoadingBody from "@/app/(app)/projects/ProjectsLoadingBody";

const ID = "11111111-2222-4333-8444-555555555555";

afterEach(cleanup);

describe("the projects loading screen", () => {
  it("the list: its skeleton, with the search strip held open", () => {
    nav.pathname = "/projects";
    const { container, queryByTestId } = render(<ProjectsLoadingBody list={<div data-testid="list" />} />);
    expect(queryByTestId("list")).not.toBeNull();
    expect(container.querySelector("[data-page-header-toolbar]")).not.toBeNull();
    expect(queryByTestId("project-loading")).toBeNull();
  });

  it("on the way to a project: that project's loading screen, no strip", () => {
    nav.pathname = `/projects/${ID}`;
    const { container, getByTestId, queryByTestId } = render(<ProjectsLoadingBody list={<div data-testid="list" />} />);
    expect(getByTestId("project-loading").textContent).toBe(ID);
    expect(queryByTestId("list")).toBeNull();
    expect(container.querySelector("[data-page-header-toolbar]")).toBeNull();
  });

  it("on the way to a project's work sheet: the sheet's shape, no strip", () => {
    nav.pathname = `/projects/${ID}/export`;
    const { container, queryByTestId } = render(<ProjectsLoadingBody list={<div data-testid="list" />} />);
    expect(queryByTestId("export-loading")).not.toBeNull();
    expect(queryByTestId("list")).toBeNull();
    expect(container.querySelector("[data-page-header-toolbar]")).toBeNull();
  });

  it("elsewhere under /projects: the skeleton without the strip", () => {
    nav.pathname = "/projects/not-a-project";
    const { container, queryByTestId } = render(<ProjectsLoadingBody list={<div data-testid="list" />} />);
    expect(queryByTestId("list")).not.toBeNull();
    expect(container.querySelector("[data-page-header-toolbar]")).toBeNull();
  });
});

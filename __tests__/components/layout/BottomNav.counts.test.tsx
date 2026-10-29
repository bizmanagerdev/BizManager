// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// The phone's bottom menu shows the side menu's counts (owner, 2026-10-29):
// on each item's top-left corner, and on the "עוד" sheet's tiles, which ask
// again when the sheet opens. The phone used to ask every minute for numbers
// it never showed (its side menu is only hidden).

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard", useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }) }));
vi.mock("@/components/layout/QuickCreateMenu", () => ({ QuickCreateMenu: () => null }));
vi.mock("@/components/powersync/useDeviceCopyPending", () => ({ useDeviceCopyPending: () => false }));

const Icon = ({ className }: { className?: string }) => <svg className={className} />;
const ITEMS = [
  { title: "דשבורד", url: "/dashboard", icon: Icon },
  { title: "פרויקטים", url: "/projects", icon: Icon },
  { title: "מכירות", url: "/sales", icon: Icon },
];
const MORE = [
  { title: "משימות", url: "/tasks", icon: Icon },
  { title: "פיננסי", url: "/financial", icon: Icon, children: [{ title: "גבייה", url: "/collections", icon: Icon }] },
];

const fetchMock = vi.fn(
  async () =>
    new Response(
      JSON.stringify({
        counts: {
          "/projects": { count: 2, severity: "warning" },
          "/tasks": { count: 5, severity: "danger" },
          "/collections": { count: 120, severity: "info" },
        },
      })
    )
);

beforeEach(() => {
  vi.resetModules();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
});

afterEach(() => vi.unstubAllGlobals());

async function renderNav() {
  const { BottomNav } = await import("@/components/layout/BottomNav");
  render(<BottomNav items={ITEMS} moreItems={MORE} viewerRole="admin" />);
}

const tab = (name: string) => screen.getAllByText(name)[0].closest("a")!;

describe("the phone's bottom menu — counts", () => {
  it("shows an item's count on its top-left corner, and nothing on an item with none", async () => {
    await renderNav();
    await waitFor(() => expect(within(tab("פרויקטים")).getByText("2")).toBeInTheDocument());
    const badge = within(tab("פרויקטים")).getByText("2");
    expect(badge).toHaveAttribute("data-nav-count");
    // Physical top-left, not the reading side.
    expect(badge.className).toContain("-left-2.5");
    expect(badge.className).toContain("-top-1.5");
    expect(badge.className).toContain("bg-warning");
    expect(tab("דשבורד").querySelector("[data-nav-count]")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("the עוד sheet's tiles carry their counts, and opening it asks again", async () => {
    await renderNav();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "עוד" }));
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const sheet = await screen.findByRole("dialog");
    await waitFor(() => expect(within(sheet).getByText("5")).toBeInTheDocument());
    expect(within(sheet).getByText("5").className).toContain("bg-destructive");
    // Over 99 reads 99+.
    expect(within(sheet).getByText("99+")).toBeInTheDocument();
  });
});

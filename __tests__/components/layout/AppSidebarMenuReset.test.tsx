// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// The logo starts the menu over (owner, 2026-10-30: pressing it should close every
// open group, "as opening up the whole website"). The logo itself lives in the top
// bar; here a button stands in for it, calling the same resetMenu.

let pathname = "/dashboard";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/ui/nav-counts-store", () => ({ useNavCounts: () => ({}) }));
vi.mock("@/hooks/useMediaQuery", () => ({ DESKTOP_MENU_QUERY: "", useMediaQuery: () => true }));
vi.mock("@/components/powersync/useDeviceCopyPending", () => ({ useDeviceCopyPending: () => false }));

import { AppSidebar } from "@/components/layout/AppSidebar";
import { SidebarCollapseProvider, useSidebarCollapse } from "@/components/layout/sidebar-collapse-context";

const Icon = () => null;
const items = [
  { title: "בית", url: "/dashboard", icon: Icon },
  {
    title: "פיננסי",
    url: "/financial",
    icon: Icon,
    children: [{ title: "תזרים", url: "/financial", icon: Icon }],
  },
  {
    title: "עובדים",
    url: "/payroll",
    icon: Icon,
    children: [{ title: "שכר", url: "/payroll", icon: Icon }],
  },
];

function Logo() {
  const { resetMenu } = useSidebarCollapse();
  return <button onClick={resetMenu}>לוגו</button>;
}

function renderMenu() {
  return render(
    <SidebarCollapseProvider>
      <Logo />
      <AppSidebar items={items} />
    </SidebarCollapseProvider>
  );
}

const open = (title: string) => fireEvent.click(screen.getByRole("button", { name: title }));
const logo = () => fireEvent.click(screen.getByRole("button", { name: "לוגו" }));

afterEach(() => {
  cleanup();
  pathname = "/dashboard";
});

describe("the logo starts the side menu over", () => {
  it("closes every group the person opened", () => {
    renderMenu();
    open("פיננסי");
    open("עובדים");
    expect(screen.getByRole("link", { name: "תזרים" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "שכר" })).toBeInTheDocument();

    logo();
    expect(screen.queryByRole("link", { name: "תזרים" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "שכר" })).not.toBeInTheDocument();
  });

  it("scrolls the menu back to its top", () => {
    const { container } = renderMenu();
    const before = container.querySelector("aside nav") as HTMLElement;
    before.scrollTop = 300;

    logo();
    const after = container.querySelector("aside nav") as HTMLElement;
    expect(after.scrollTop).toBe(0);
  });

  it("a group can be opened again afterwards", () => {
    renderMenu();
    open("פיננסי");
    logo();
    open("פיננסי");
    expect(screen.getByRole("link", { name: "תזרים" })).toBeInTheDocument();
  });

  it("a group holding the current page still opens by itself", () => {
    pathname = "/payroll";
    renderMenu();
    open("פיננסי");
    logo();
    expect(screen.queryByRole("link", { name: "תזרים" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "שכר" })).toBeInTheDocument();
  });
});

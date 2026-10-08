// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";

// The sales loading screen holds the phone's header strip open — every sales
// tab fills it — but only on /sales itself: the same loading screen shows on
// the way to a new order or an order's edit page, which have no strip.

const nav = vi.hoisted(() => ({ pathname: "/sales" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

import SalesLoadingStrip from "@/app/(app)/sales/SalesLoadingStrip";

afterEach(cleanup);

describe("the sales loading screen's strip", () => {
  it("held open on /sales", () => {
    nav.pathname = "/sales";
    const { container } = render(<SalesLoadingStrip />);
    expect(container.querySelector("[data-page-header-toolbar]")).not.toBeNull();
  });

  it("not on the pages under it", () => {
    nav.pathname = "/sales/orders/new";
    const { container } = render(<SalesLoadingStrip />);
    expect(container.querySelector("[data-page-header-toolbar]")).toBeNull();
  });
});

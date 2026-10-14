// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

// The customers list's loading screen is the page's own shape (no jumps when
// the list arrives): the table from lg with the ⋮ column and no סטטוס, the
// cards with the four sections' corner, the md+ toolbar, the filter summary
// line when the address has filters — and the top bar's count line held from
// the first frame. A failed load keeps the phone strip open.

const nav = vi.hoisted(() => ({
  search: "",
  pathname: "/customers",
  router: { push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => nav.router,
  useSearchParams: () => new URLSearchParams(nav.search),
  usePathname: () => nav.pathname,
}));
vi.mock("@/app/(app)/customers/[id]/CustomerPageSkeleton", () => ({
  default: () => <div data-testid="customer-page-skeleton" />,
}));

import CustomersSkeleton from "@/app/(app)/customers/CustomersSkeleton";
import CustomersLoadingBody from "@/app/(app)/customers/CustomersLoadingBody";
import CustomersLoadError from "@/app/(app)/customers/CustomersLoadError";
import CustomersTitle, { useCustomersTitle } from "@/app/(app)/customers/CustomersTitle";
import { PageTitleProvider, usePageTitle } from "@/components/layout/page-title-context";

beforeEach(() => {
  vi.clearAllMocks();
  nav.search = "";
  nav.pathname = "/customers";
});

function TitleProbe() {
  const title = usePageTitle();
  return <div data-testid="title" data-subtitle={title?.subtitle ?? ""}>{title ? String(title.title) : ""}</div>;
}

describe("CustomersSkeleton", () => {
  it("is the new table: from lg, the ⋮ column, no סטטוס", () => {
    render(<CustomersSkeleton />);
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "לקוח",
      "טלפון ואימייל",
      "כתובת",
      "Morning",
      "הזמנות",
      "פרויקטים",
      "חוב פתוח",
      "פעולות",
    ]);
    expect(table.closest(".lg\\:block")).not.toBeNull();
  });

  it("draws the cards with the list cards' corner, and the toolbar from md", () => {
    const { container } = render(<CustomersSkeleton />);
    expect(container.querySelectorAll(".rounded-card").length).toBeGreaterThan(0);
    expect(container.querySelector(".rounded-2xl")).toBeNull();
    expect(screen.getByText("חיפוש לקוחות").closest(".md\\:grid")).not.toBeNull();
    expect(screen.getByText("החלק כרטיס ימינה לפעולות · הקש לפתיחה")).toBeInTheDocument();
  });

  it("holds the filter summary line when the address has filters", () => {
    nav.search = "with_debt=yes";
    render(<CustomersSkeleton />);
    expect(screen.getByText("חוב פתוח: עם חוב פתוח")).toBeInTheDocument();
  });
});

describe("CustomersLoadingBody", () => {
  it("on the list: its title with the count line held, and its shape", () => {
    render(
      <PageTitleProvider>
        <TitleProbe />
        <CustomersLoadingBody />
      </PageTitleProvider>
    );
    expect(screen.getByTestId("title")).toHaveTextContent("לקוחות");
    // A line of its own before the count is known, so the count can't move the title.
    expect(screen.getByTestId("title").getAttribute("data-subtitle")).toBe(String.fromCharCode(0xa0));
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("on the way to a customer: that page's own shape", () => {
    nav.pathname = "/customers/c1";
    render(<CustomersLoadingBody />);
    expect(screen.getByTestId("customer-page-skeleton")).toBeInTheDocument();
  });
});

describe("CustomersTitle", () => {
  it("shows the count the list last had once it's known", () => {
    function List() {
      useCustomersTitle(655);
      return null;
    }
    const view = render(
      <PageTitleProvider>
        <TitleProbe />
        <List />
      </PageTitleProvider>
    );
    expect(screen.getByTestId("title").getAttribute("data-subtitle")).toBe("655 לקוחות");
    view.rerender(
      <PageTitleProvider>
        <TitleProbe />
        <CustomersTitle />
      </PageTitleProvider>
    );
    expect(screen.getByTestId("title").getAttribute("data-subtitle")).toBe("655 לקוחות");
  });
});

describe("CustomersLoadError", () => {
  it("keeps the phone strip open, says what failed in Hebrew, and tries again", () => {
    const { container } = render(<CustomersLoadError message="אירעה שגיאה. נסו שוב." />);
    expect(container.querySelector("[data-page-header-toolbar]")).not.toBeNull();
    expect(screen.getByText(/שגיאה בטעינת לקוחות: אירעה שגיאה/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "נסו שוב" }));
    expect(nav.router.refresh).toHaveBeenCalled();
  });
});

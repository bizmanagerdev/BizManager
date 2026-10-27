// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The "בנסיעה" bar: on every page but the route's own while a drive is kept on
// this phone, and gone once it ends.

const nav = vi.hoisted(() => ({ pathname: "/tasks" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

import DriveBar from "@/components/layout/DriveBar";
import { DRIVE_CHANGED_EVENT, DRIVE_STORAGE_KEY, type Drive } from "@/lib/routes/drive";
import { israelDateKey } from "@/lib/timezone";

function keep(over: Partial<Drive> = {}) {
  const stop = (key: string, name: string) => ({
    key,
    kind: "delivery" as const,
    name,
    phone: null,
    city: "ירושלים",
    address: "הרצל 5",
    orderIds: [`order-${key}`],
    collectOnDelivery: false,
    note: null,
    lat: 31.78,
    lng: 35.2,
    arrival: null,
  });
  const drive: Drive = {
    day: israelDateKey(),
    stops: [stop("a", "פיצה אורי"), stop("b", "מאפיית כהן")],
    end: null,
    at: 1,
    outcome: { a: "delivered" },
    confirmed: ["order-a"],
    ...over,
  };
  localStorage.setItem(DRIVE_STORAGE_KEY, JSON.stringify(drive));
}

beforeEach(() => {
  nav.pathname = "/tasks";
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe("DriveBar", () => {
  it("names the stop the driver is on and leads back to the drive", () => {
    keep();
    render(<DriveBar />);
    const bar = screen.getByRole("link");
    expect(bar).toHaveAttribute("href", "/deliveries/route");
    expect(bar).toHaveTextContent("בנסיעה אל מאפיית כהן · 2/2");
    expect(bar).toHaveTextContent("חזרה לנסיעה");
  });

  it("not on the route page itself", () => {
    keep();
    nav.pathname = "/deliveries/route";
    render(<DriveBar />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("nothing without a drive, or with yesterday's", () => {
    const { unmount } = render(<DriveBar />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    unmount();
    keep({ day: "2020-01-01" });
    render(<DriveBar />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("goes when the drive ends", () => {
    keep();
    render(<DriveBar />);
    expect(screen.getByRole("link")).toBeInTheDocument();
    act(() => {
      localStorage.removeItem(DRIVE_STORAGE_KEY);
      window.dispatchEvent(new Event(DRIVE_CHANGED_EVENT));
    });
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("every stop behind: says so", () => {
    keep({ at: 2, outcome: { a: "delivered", b: "skipped" } });
    render(<DriveBar />);
    expect(screen.getByRole("link")).toHaveTextContent("עברתם את כל העצירות");
  });
});

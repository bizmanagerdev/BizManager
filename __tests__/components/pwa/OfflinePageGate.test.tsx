// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

// A page moved to with no connection whose data isn't on the device opens with
// a word in its place that it isn't — the menu and the red bar stay, the next
// page a tap away (owner, 2026-10-28: "Spotify style"). It loads by itself once
// the server answers again.

const h = vi.hoisted(() => ({ pathname: "/calendar", reachable: false }));
vi.mock("next/navigation", () => ({ usePathname: () => h.pathname }));
vi.mock("@/lib/pwa/connection", () => ({ useServerReachable: () => h.reachable }));

import OfflinePageGate from "@/components/pwa/OfflinePageGate";
import { markPageNotOnDevice, pageNotOnDevice } from "@/lib/pwa/page-not-on-device";

const reload = vi.fn();
const MESSAGE = "הדף הזה לא זמין בלי חיבור";

function page() {
  return render(
    <OfflinePageGate>
      <p>the calendar</p>
    </OfflinePageGate>
  );
}

describe("the page area, for a page not on the device", () => {
  beforeEach(() => {
    h.pathname = "/calendar";
    h.reachable = false;
    reload.mockReset();
    markPageNotOnDevice(null);
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, pathname: "/calendar", search: "", reload },
    });
  });
  afterEach(() => cleanup());

  it("any other time: the page itself", () => {
    page();
    expect(screen.getByText("the calendar")).toBeTruthy();
    expect(screen.queryByText(MESSAGE)).toBeNull();
  });

  it("this page marked: says so in its place", () => {
    page();
    act(() => markPageNotOnDevice("/calendar"));
    expect(screen.getByText(MESSAGE)).toBeTruthy();
    expect(screen.queryByText("the calendar")).toBeNull();
  });

  it("another page marked (the app hasn't moved there yet): this page as it is", () => {
    h.pathname = "/dashboard";
    const { rerender } = page();
    act(() => markPageNotOnDevice("/calendar"));
    expect(screen.queryByText(MESSAGE)).toBeNull();
    expect(pageNotOnDevice()).toBe("/calendar");
    // …until it does.
    h.pathname = "/calendar";
    rerender(
      <OfflinePageGate>
        <p>the calendar</p>
      </OfflinePageGate>
    );
    expect(screen.getByText(MESSAGE)).toBeTruthy();
  });

  it("the server answering again: the page loads by itself, once", () => {
    const { rerender } = page();
    act(() => markPageNotOnDevice("/calendar"));
    expect(reload).not.toHaveBeenCalled();
    h.reachable = true;
    rerender(
      <OfflinePageGate>
        <p>the calendar</p>
      </OfflinePageGate>
    );
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("an answer counted from before the move doesn't load it: only one seen after it wasn't answering", () => {
    h.reachable = true;
    page();
    act(() => markPageNotOnDevice("/calendar"));
    expect(reload).not.toHaveBeenCalled();
  });

  it("left (Back, say): the mark goes, and the page opens as usual next time", () => {
    const { rerender } = page();
    act(() => markPageNotOnDevice("/calendar"));
    h.pathname = "/dashboard";
    rerender(
      <OfflinePageGate>
        <p>the dashboard</p>
      </OfflinePageGate>
    );
    expect(screen.getByText("the dashboard")).toBeTruthy();
    expect(pageNotOnDevice()).toBeNull();
  });
});

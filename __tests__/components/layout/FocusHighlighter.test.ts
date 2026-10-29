// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flashFocusTarget } from "@/components/layout/FocusHighlighter";

// A link to one row (?focus=<id>) scrolls to it when it arrives. Someone who has
// started doing something meanwhile is left where they are (owner, 2026-10-29:
// an expense opened from a link "keeps jumping up even if I start doing other
// stuff on the page").

let scrolled: string[];

beforeEach(() => {
  vi.useFakeTimers();
  scrolled = [];
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this.getAttribute("data-focus-id") ?? "");
  };
  // jsdom lays nothing out: count every element as on screen.
  Element.prototype.getClientRects = () => [{}] as unknown as DOMRectList;
});
afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

function rowArrives(id: string) {
  const row = document.createElement("div");
  row.setAttribute("data-focus-id", id);
  document.body.append(row);
}

describe("flashFocusTarget", () => {
  it("scrolls to the row when it arrives, if nothing was done meanwhile", () => {
    const cancel = flashFocusTarget("expense:e1");
    vi.advanceTimersByTime(600);
    rowArrives("expense:e1");
    vi.advanceTimersByTime(300);
    expect(scrolled).toEqual(["expense:e1"]);
    cancel();
  });

  it.each(["wheel", "touchstart", "pointerdown", "keydown"])("stops looking once the person %s's — the page isn't pulled away later", (type) => {
    const cancel = flashFocusTarget("expense:e1");
    vi.advanceTimersByTime(600);
    window.dispatchEvent(new Event(type));
    rowArrives("expense:e1");
    vi.advanceTimersByTime(8000);
    expect(scrolled).toEqual([]);
    cancel();
  });

  it("once the row is found, later scrolling and taps are the person's own", () => {
    rowArrives("expense:e1");
    const cancel = flashFocusTarget("expense:e1");
    expect(scrolled).toEqual(["expense:e1"]);
    window.dispatchEvent(new Event("wheel"));
    vi.advanceTimersByTime(8000);
    expect(scrolled).toEqual(["expense:e1"]);
    cancel();
  });
});

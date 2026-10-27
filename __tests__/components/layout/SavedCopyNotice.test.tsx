// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

// A page the app showed from its saved copy because the server didn't answer
// (marked by the service worker on <html data-bizh-saved>): says so, and
// reloads itself the moment the server answers — unless that already happened
// a moment ago (then a button, not a reload loop). An ordinary page: nothing.

// Whether the server answers (lib/pwa/connection.ts): with no connection at all,
// the red bar says it and this one steps aside (owner, 2026-10-27: two bars
// saying the same thing).
const net = vi.hoisted(() => ({ up: true }));
vi.mock("@/lib/pwa/connection", () => ({ useServerReachable: () => net.up }));

import SavedCopyNotice from "@/components/layout/SavedCopyNotice";

const reload = vi.fn();

describe("SavedCopyNotice", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    reload.mockReset();
    net.up = true;
    sessionStorage.clear();
    delete document.documentElement.dataset.bizhSaved;
    Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, reload, pathname: "/deliveries" } });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("no connection at all: not shown (the red bar says it) — and still reloads once the server answers", async () => {
    document.documentElement.dataset.bizhSaved = String(Date.parse("2026-10-27T14:13:00Z"));
    net.up = false;
    let serverBack = false;
    vi.stubGlobal("fetch", vi.fn(async () => (serverBack ? new Response(null, { status: 204 }) : Promise.reject(new TypeError("Failed to fetch")))));
    const { container } = render(<SavedCopyNotice />);
    expect(container.textContent).toBe("");
    serverBack = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("an ordinary page: nothing", () => {
    const { container } = render(<SavedCopyNotice />);
    expect(container.textContent).toBe("");
  });

  it("a saved copy: says so — and reloads once the server answers", async () => {
    document.documentElement.dataset.bizhSaved = String(Date.parse("2026-10-07T14:20:00Z"));
    let serverBack = false;
    vi.stubGlobal("fetch", vi.fn(async () => (serverBack ? new Response(null, { status: 204 }) : Promise.reject(new TypeError("Failed to fetch")))));
    render(<SavedCopyNotice />);
    expect(screen.getByRole("status").textContent).toContain("מוצגת הגרסה השמורה במכשיר");
    expect(screen.getByRole("status").textContent).toContain("תתעדכן לבד");

    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(reload).not.toHaveBeenCalled();
    serverBack = true;
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("a saved copy again right after reloading for a fresh one: a button, no reload loop", async () => {
    document.documentElement.dataset.bizhSaved = "0";
    sessionStorage.setItem("bizh-saved-reload:/deliveries", String(Date.now() - 10_000));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    render(<SavedCopyNotice />);
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "נסה שוב" })).toBeTruthy();
  });
});

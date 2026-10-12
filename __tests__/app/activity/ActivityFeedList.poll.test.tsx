// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";

// The activity feed FETCHES new actions once a minute while it's on screen —
// it doesn't listen live. A live listener on audit_logs had the database match
// every saved row against every open screen, and hours of data entry froze it
// (2026-10-12; owner: "if activity caused this then revert the change").

const { getAuditFeed, channel } = vi.hoisted(() => ({
  getAuditFeed: vi.fn(),
  channel: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({ channel, removeChannel: vi.fn(), auth: { getSession: vi.fn() } }),
}));
vi.mock("@/lib/audit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/audit")>()),
  getAuditFeed,
}));
vi.mock("@/lib/activity/search", () => ({ searchActivity: vi.fn() }));

import ActivityFeedList from "@/app/(app)/activity/ActivityFeedList";

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
}

function renderFeed(onArrivals = vi.fn(), onLiveChange = vi.fn()) {
  render(
    <ActivityFeedList
      initialItems={[]}
      initialHasMore={false}
      error={null}
      table=""
      action=""
      actorFilterValues={[]}
      query=""
      usersOnly={false}
      todayKey="2026-10-12"
      todayCount={0}
      onLiveChange={onLiveChange}
      onArrivals={onArrivals}
      dimmed={false}
    />
  );
  return { onArrivals, onLiveChange };
}

describe("ActivityFeedList — new actions are fetched, not pushed", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getAuditFeed.mockReset().mockResolvedValue({ items: [], error: null });
    channel.mockReset();
    setVisibility("visible");
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens no live listener on the database", () => {
    const { onLiveChange } = renderFeed();
    expect(channel).not.toHaveBeenCalled();
    // Still "updates by itself" for the page's live dot.
    expect(onLiveChange).toHaveBeenCalledWith(true);
  });

  it("asks once a minute while the page is on screen, and nothing in between", async () => {
    renderFeed();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_000);
    });
    expect(getAuditFeed).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(getAuditFeed).toHaveBeenCalledTimes(1);
  });

  it("doesn't ask while the page is hidden, and asks the moment it's back", async () => {
    renderFeed();
    setVisibility("hidden");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180_000);
    });
    expect(getAuditFeed).not.toHaveBeenCalled();

    setVisibility("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(getAuditFeed).toHaveBeenCalledTimes(1);
  });

  it("refreshes the page's numbers only when something new came in", async () => {
    const { onArrivals } = renderFeed();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(onArrivals).not.toHaveBeenCalled();
  });
});

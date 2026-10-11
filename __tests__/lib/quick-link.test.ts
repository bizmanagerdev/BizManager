// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { takeQuickParam } from "@/lib/quick-link";

// The phone app's long-press shortcuts open /dashboard?quick=task (or order,
// search): the part of the page that handles the value takes it once and drops
// it from the address.

describe("takeQuickParam", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/dashboard");
  });

  it("returns an accepted value and removes it from the address, keeping the rest", () => {
    window.history.replaceState({ keep: 1 }, "", "/dashboard?quick=task&tab=today#top");
    expect(takeQuickParam(["task", "order"] as const)).toBe("task");
    expect(window.location.pathname + window.location.search + window.location.hash).toBe("/dashboard?tab=today#top");
    expect(window.history.state).toEqual({ keep: 1 });
    // Taken once: a second reader (Back, a refresh) finds nothing.
    expect(takeQuickParam(["task", "order"] as const)).toBeNull();
  });

  it("leaves a value it doesn't accept for another part of the page", () => {
    window.history.replaceState(null, "", "/dashboard?quick=search");
    expect(takeQuickParam(["task", "order"] as const)).toBeNull();
    expect(window.location.search).toBe("?quick=search");
    expect(takeQuickParam(["search"] as const)).toBe("search");
    expect(window.location.search).toBe("");
  });

  it("is null with no ?quick=", () => {
    expect(takeQuickParam(["task"] as const)).toBeNull();
  });
});

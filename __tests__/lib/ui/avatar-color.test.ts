import { describe, it, expect, vi } from "vitest";
import { getAvatarColorCache, setAvatarColorCache, subscribeAvatarColor } from "@/lib/ui/avatar-color";

describe("avatar color cache", () => {
  it("starts unset (undefined = not loaded this session)", () => {
    // NOTE: this module is a process-wide singleton, so this only holds true
    // if it runs before any other test in the suite touches it. Guard by
    // resetting explicitly rather than asserting the pristine default.
    setAvatarColorCache(null);
    expect(getAvatarColorCache()).toBeNull();
  });

  it("stores whatever value it's given, including an explicit null (\"auto\")", () => {
    setAvatarColorCache("#2563EB");
    expect(getAvatarColorCache()).toBe("#2563EB");
    setAvatarColorCache(null);
    expect(getAvatarColorCache()).toBeNull();
  });

  it("notifies every subscriber on a set, and stops once unsubscribed", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAvatarColor(listener);

    setAvatarColorCache("#16A34A");
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    setAvatarColorCache("#DC2626");
    expect(listener).toHaveBeenCalledTimes(1); // no further calls after unsubscribing
  });

  it("supports multiple independent subscribers", () => {
    const a = vi.fn();
    const b = vi.fn();
    subscribeAvatarColor(a);
    subscribeAvatarColor(b);
    setAvatarColorCache("#9333EA");
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});

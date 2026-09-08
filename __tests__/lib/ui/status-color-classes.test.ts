import { describe, it, expect } from "vitest";
import {
  getStatusColorClasses,
  getStatusDotClasses,
  getStatusBorderClasses,
  STATUS_PILL_CLASSES,
} from "@/lib/ui/status-color-classes";
import type { StatusColor } from "@/lib/ui/status-colors";

const COLORS: StatusColor[] = ["success", "warning", "danger", "info", "neutral"];

describe("getStatusColorClasses", () => {
  it("returns the pill classes for every status color, each one distinct", () => {
    const results = COLORS.map(getStatusColorClasses);
    expect(new Set(results).size).toBe(COLORS.length);
    for (const color of COLORS) {
      expect(getStatusColorClasses(color)).toBe(STATUS_PILL_CLASSES[color]);
    }
  });
  it("warning uses navy (foreground) text, not orange-on-light (unreadable)", () => {
    expect(getStatusColorClasses("warning")).toContain("text-warning-soft-foreground");
  });
});

describe("getStatusDotClasses / getStatusBorderClasses", () => {
  it("every color maps to a distinct, non-empty dot class", () => {
    const results = COLORS.map(getStatusDotClasses);
    expect(results.every(Boolean)).toBe(true);
    expect(new Set(results).size).toBe(COLORS.length);
  });
  it("every color maps to a distinct, non-empty border class", () => {
    const results = COLORS.map(getStatusBorderClasses);
    expect(results.every(Boolean)).toBe(true);
    expect(new Set(results).size).toBe(COLORS.length);
  });
});

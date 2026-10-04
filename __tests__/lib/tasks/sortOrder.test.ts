import { describe, it, expect } from "vitest";
import { computeInsertSortOrder } from "@/lib/tasks/sortOrder";

describe("computeInsertSortOrder — fractional-index drag drop / top-of-list insert", () => {
  it("drops between two neighbors at their midpoint", () => {
    expect(computeInsertSortOrder(10, 20)).toBe(15);
  });

  it("no 'before' neighbor (insert at the top) sorts ahead of the 'after' value", () => {
    const value = computeInsertSortOrder(null, 100);
    expect(value).toBeLessThan(100);
  });

  it("no 'after' neighbor (insert at the bottom) sorts behind the 'before' value", () => {
    const value = computeInsertSortOrder(100, null);
    expect(value).toBeGreaterThan(100);
  });

  it("a new task lands above the column's current top, whatever its due date (no date ordering)", () => {
    expect(computeInsertSortOrder(null, 1.79e12)).toBeLessThan(1.79e12);
  });

  it("repeated top-inserts keep climbing above the previous one", () => {
    const first = computeInsertSortOrder(null, 10);
    const second = computeInsertSortOrder(null, first);
    expect(second).toBeLessThan(first);
    expect(first).toBeLessThan(10);
  });
});

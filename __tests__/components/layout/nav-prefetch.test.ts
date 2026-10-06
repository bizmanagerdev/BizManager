import { describe, it, expect } from "vitest";
import { isFullyPrefetched } from "@/components/layout/nav-items";

// Which pages the nav loads ahead of a click: the busiest ones for everyone,
// and /tasks only for the people who get its device version — for them it's
// just the page's frame; for a worker it's the whole board on the server.
describe("isFullyPrefetched", () => {
  it("the busiest pages, for everyone", () => {
    for (const role of ["admin", "office", "worker"]) {
      expect(isFullyPrefetched("/dashboard", role)).toBe(true);
      expect(isFullyPrefetched("/projects", role)).toBe(true);
      expect(isFullyPrefetched("/sales", role)).toBe(true);
    }
  });

  it("/tasks for admins and office (a device page), not for workers", () => {
    expect(isFullyPrefetched("/tasks", "admin")).toBe(true);
    expect(isFullyPrefetched("/tasks", "office")).toBe(true);
    expect(isFullyPrefetched("/tasks", "worker")).toBe(false);
    expect(isFullyPrefetched("/tasks", undefined)).toBe(false);
  });

  it("nothing else", () => {
    expect(isFullyPrefetched("/customers", "admin")).toBe(false);
  });
});

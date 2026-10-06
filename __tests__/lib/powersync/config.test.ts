import { describe, it, expect } from "vitest";
import { LOCAL_DATA_PAGES, LOCAL_DATA_PREVIEW_USERS, localDataPageOn } from "@/lib/powersync/config";

// Who gets a page's device version: everyone with a device copy (admins and
// office) once the page's switch is on — all four are, from 2026-10-06 — and
// before that only the people trying it out. Never anyone without a copy.
describe("localDataPageOn", () => {
  it("admins and office get the device version of every page that's switched on", () => {
    for (const page of Object.keys(LOCAL_DATA_PAGES) as Array<keyof typeof LOCAL_DATA_PAGES>) {
      expect(LOCAL_DATA_PAGES[page]).toBe(true);
      expect(localDataPageOn(page, { id: "someone", role: "admin" })).toBe(true);
      expect(localDataPageOn(page, { id: "someone", role: "office" })).toBe(true);
    }
  });

  it("never without a device copy (workers), even for the people trying it out", () => {
    expect(localDataPageOn("tasks", { id: "someone", role: "worker" })).toBe(false);
    expect(localDataPageOn("tasks", { id: LOCAL_DATA_PREVIEW_USERS[0], role: "worker" })).toBe(false);
  });
});

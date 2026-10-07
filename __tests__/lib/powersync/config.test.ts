import { describe, it, expect } from "vitest";
import {
  LOCAL_DATA_PAGES,
  LOCAL_DATA_PREVIEW_USERS,
  LOCAL_DATA_WORKERS,
  localDataEnabledFor,
  localDataPageFor,
  localDataPageOn,
} from "@/lib/powersync/config";

// Who keeps a device copy (admins, office and workers) and who gets a page's
// device version: admins and office for every page that's switched on (the
// first four from 2026-10-06, an order's page from 2026-10-07; a project's
// page once sync rules v1.7 are live) — and before that the people trying it
// out;
// workers only their dashboard and tasks, and only once their own switch is
// on (after a day of comparisons). Never anyone else.
describe("the device copy's switches", () => {
  it("admins, office and workers keep a copy; nobody else", () => {
    expect(localDataEnabledFor("admin")).toBe(true);
    expect(localDataEnabledFor("office")).toBe(true);
    expect(localDataEnabledFor("worker")).toBe(LOCAL_DATA_WORKERS.sync);
    expect(localDataEnabledFor("worker_no_access")).toBe(false);
    expect(localDataEnabledFor(undefined)).toBe(false);
  });

  it("admins and office get the device version of every page that's switched on", () => {
    for (const page of Object.keys(LOCAL_DATA_PAGES) as Array<keyof typeof LOCAL_DATA_PAGES>) {
      expect(localDataPageOn(page, { id: "someone", role: "admin" })).toBe(LOCAL_DATA_PAGES[page]);
      expect(localDataPageOn(page, { id: "someone", role: "office" })).toBe(LOCAL_DATA_PAGES[page]);
    }
  });

  it("a page still switched off (a project's page, until sync rules v1.7 are live): only the people trying it out", () => {
    expect(LOCAL_DATA_PAGES.projectPage).toBe(false);
    expect(localDataPageOn("projectPage", { id: "someone", role: "admin" })).toBe(false);
    expect(localDataPageOn("projectPage", { id: LOCAL_DATA_PREVIEW_USERS[0], role: "admin" })).toBe(true);
  });

  it("workers: their pages stay on the server while their switch is off — even for the people trying it out", () => {
    expect(LOCAL_DATA_WORKERS.pages).toBe(false);
    for (const page of Object.keys(LOCAL_DATA_PAGES) as Array<keyof typeof LOCAL_DATA_PAGES>) {
      expect(localDataPageFor(page, "worker")).toBe(false);
      expect(localDataPageOn(page, { id: LOCAL_DATA_PREVIEW_USERS[0], role: "worker" })).toBe(false);
    }
  });

  it("never the staff-only pages for a worker, nor any page for someone without a copy", () => {
    expect(localDataPageFor("projects", "worker")).toBe(false);
    expect(localDataPageFor("sales", "worker")).toBe(false);
    expect(localDataPageOn("tasks", { id: "someone", role: "worker_no_access" })).toBe(false);
  });
});

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
// first four from 2026-10-06, an order's page from 2026-10-07, a project's
// page from 2026-10-08) — and before a switch is on, the people trying it out;
// workers only their dashboard and tasks (from 2026-10-08, after a day of
// clean comparisons) — except workers reading Arabic, whose pages stay on the
// server (it translates task names as they read them). Never anyone else.
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

  it("a project's page: on for every admin and office user", () => {
    expect(LOCAL_DATA_PAGES.projectPage).toBe(true);
    expect(localDataPageOn("projectPage", { id: "someone", role: "admin" })).toBe(true);
  });

  it("a page still switched off (the money cards, until their comparisons): only the people trying it out", () => {
    expect(LOCAL_DATA_PAGES.dashboardMoney).toBe(false);
    expect(localDataPageOn("dashboardMoney", { id: "someone", role: "admin" })).toBe(false);
    expect(localDataPageOn("dashboardMoney", { id: LOCAL_DATA_PREVIEW_USERS[0], role: "admin" })).toBe(true);
  });

  it("workers: their dashboard and tasks from the device — in Hebrew; reading Arabic, on the server", () => {
    expect(LOCAL_DATA_WORKERS.pages).toBe(true);
    expect(localDataPageOn("dashboard", { id: "w1", role: "worker", locale: "he" })).toBe(true);
    expect(localDataPageOn("tasks", { id: "w1", role: "worker", locale: "he" })).toBe(true);
    expect(localDataPageOn("dashboard", { id: "w2", role: "worker", locale: "ar" })).toBe(false);
    expect(localDataPageOn("tasks", { id: "w2", role: "worker", locale: "ar" })).toBe(false);
    // Their locale has to be known (a caller that doesn't know it keeps them on the server).
    expect(localDataPageFor("tasks", "worker")).toBe(false);
  });

  it("never the staff-only pages for a worker — not even for the people trying them out — nor any page for someone without a copy", () => {
    for (const page of ["projects", "sales", "orders", "projectPage", "dashboardMoney"] as const) {
      expect(localDataPageFor(page, "worker", "he")).toBe(false);
      expect(localDataPageOn(page, { id: LOCAL_DATA_PREVIEW_USERS[0], role: "worker", locale: "he" })).toBe(false);
    }
    expect(localDataPageOn("tasks", { id: "someone", role: "worker_no_access", locale: "he" })).toBe(false);
  });
});

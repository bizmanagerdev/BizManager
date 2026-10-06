import { describe, it, expect } from "vitest";
import { LOCAL_DATA_PAGES, LOCAL_DATA_PREVIEW_USERS, localDataPageOn } from "@/lib/powersync/config";

// Who gets a page's device version: everyone with a device copy once the
// page's switch is on; before that, only the people trying it out.
describe("localDataPageOn", () => {
  const tryingIt = LOCAL_DATA_PREVIEW_USERS[0];

  it("the people trying it out get the device version of a page whose switch is still off", () => {
    expect(LOCAL_DATA_PAGES.tasks).toBe(false);
    expect(localDataPageOn("tasks", { id: tryingIt, role: "admin" })).toBe(true);
  });

  it("everyone else keeps the server version until the switch is on", () => {
    expect(localDataPageOn("tasks", { id: "someone-else", role: "admin" })).toBe(false);
    expect(localDataPageOn("dashboard", { id: "someone-else", role: "office" })).toBe(false);
  });

  it("never without a device copy (workers), even on the list", () => {
    expect(localDataPageOn("tasks", { id: tryingIt, role: "worker" })).toBe(false);
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { UPDATE_RETRY_MS, isNewerBuild, mayReloadFrom, noteReloadFrom, swBuildOf } from "@/lib/pwa/app-version";
import { GET } from "@/app/api/ping/route";

// Which version runs, whether a newer one is live, and the reload guard.

afterEach(() => sessionStorage.clear());

describe("app version", () => {
  it("a newer build only when the server names another one", () => {
    expect(isNewerBuild("new2", "old1")).toBe(true);
    expect(isNewerBuild("old1", "old1")).toBe(false);
    expect(isNewerBuild(null, "old1")).toBe(false);
    expect(isNewerBuild("", "old1")).toBe(false);
    expect(isNewerBuild("new2", "")).toBe(false);
  });

  it("reads the build a service worker was registered for", () => {
    expect(swBuildOf("https://www.biz-h.com/sw.js?v=abc12345")).toBe("abc12345");
    expect(swBuildOf("/sw.js")).toBeNull();
    expect(swBuildOf(undefined)).toBeNull();
  });

  it("reloads once per build, and again only after a while", () => {
    const at = Date.parse("2026-10-20T08:00:00Z");
    expect(mayReloadFrom("old1", at)).toBe(true);
    noteReloadFrom("old1", at);
    expect(mayReloadFrom("old1", at + 1000)).toBe(false);
    expect(mayReloadFrom("old1", at + UPDATE_RETRY_MS)).toBe(true);
    // A reload that did move on: the new build may move on again at once.
    expect(mayReloadFrom("new2", at + 1000)).toBe(true);
  });

  it("/api/ping says which build the server runs, never cached", () => {
    const res = GET();
    expect(res.status).toBe(204);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.has("X-Bizh-Build")).toBe(true);
  });
});

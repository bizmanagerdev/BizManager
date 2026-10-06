// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  STORED_RESULT_MAX_AGE_MS,
  clearStoredResults,
  parseStoredResult,
  readStoredResultRaw,
  storeResult,
} from "@/lib/powersync/stored-results";

// The device pages' last results, kept on the device between visits: read
// back while under a day old, the most recent ones only, and wiped at logout
// or when someone else signs in.

describe("stored device results", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.useRealTimers());

  it("stores and reads back a result, while it's under a day old", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-06T08:00:00Z"));
    storeResult("me|admin|he|tasksBoard|{}", { items: [{ id: "t1" }] });
    expect(parseStoredResult(readStoredResultRaw("me|admin|he|tasksBoard|{}"))).toEqual({ data: { items: [{ id: "t1" }] } });
    expect(readStoredResultRaw("me|admin|he|salesOrders|{}")).toBeNull();

    vi.setSystemTime(new Date(Date.parse("2026-10-06T08:00:00Z") + STORED_RESULT_MAX_AGE_MS + 1));
    expect(readStoredResultRaw("me|admin|he|tasksBoard|{}")).toBeNull();
  });

  it("keeps the most recent ones only", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    for (let i = 0; i < 30; i += 1) {
      vi.setSystemTime(new Date(Date.parse("2026-10-06T08:00:00Z") + i * 1000));
      storeResult(`me|admin|he|k${i}|null`, i);
    }
    expect(readStoredResultRaw("me|admin|he|k0|null")).toBeNull();
    expect(parseStoredResult(readStoredResultRaw("me|admin|he|k29|null"))).toEqual({ data: 29 });
    expect(Object.keys(localStorage).filter((k) => k.startsWith("bizh-local:"))).toHaveLength(24);
  });

  it("someone else signs in: only their own stay; logout: none, and nothing else is touched", () => {
    storeResult("me|admin|he|tasksBoard|{}", 1);
    storeResult("other|office|he|tasksBoard|{}", 2);
    localStorage.setItem("bizh-card:payments", "kept");

    clearStoredResults("me");
    expect(readStoredResultRaw("me|admin|he|tasksBoard|{}")).not.toBeNull();
    expect(readStoredResultRaw("other|office|he|tasksBoard|{}")).toBeNull();

    clearStoredResults();
    expect(readStoredResultRaw("me|admin|he|tasksBoard|{}")).toBeNull();
    expect(localStorage.getItem("bizh-card:payments")).toBe("kept");
  });
});

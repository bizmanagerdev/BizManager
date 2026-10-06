// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { clearRememberedCards, readRememberedCardRaw, rememberCard } from "@/lib/ui/remembered-cards";

// The money cards' last version, kept on the device for the next visit's
// placeholder: per person and card, a day at most, wiped at logout.

describe("remembered dashboard cards", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.useRealTimers());

  it("keeps a card's props and gives them back for the same card", () => {
    rememberCard("u1:payments", "payments", { summary: { todayTotal: 5 } });
    const raw = readRememberedCardRaw("u1:payments", "payments");
    expect(raw && JSON.parse(raw).props).toEqual({ summary: { todayTotal: 5 } });
    expect(readRememberedCardRaw("u1:payments", "collections")).toBeNull();
    expect(readRememberedCardRaw("u2:payments", "payments")).toBeNull();
  });

  it("forgets a card that came back empty", () => {
    rememberCard("u1:collections", "collections", { summary: {} });
    rememberCard("u1:collections", "collections", null);
    expect(readRememberedCardRaw("u1:collections", "collections")).toBeNull();
  });

  it("ignores a copy older than a day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-06T08:00:00Z"));
    rememberCard("u1:domainChart", "domainChart", { initialBars: [] });
    vi.setSystemTime(new Date("2026-10-07T07:59:00Z"));
    expect(readRememberedCardRaw("u1:domainChart", "domainChart")).not.toBeNull();
    vi.setSystemTime(new Date("2026-10-07T08:01:00Z"));
    expect(readRememberedCardRaw("u1:domainChart", "domainChart")).toBeNull();
  });

  it("logout clears every remembered card and nothing else", () => {
    localStorage.setItem("other-setting", "keep");
    rememberCard("u1:payments", "payments", { a: 1 });
    rememberCard("u2:collections", "collections", { b: 2 });
    clearRememberedCards();
    expect(readRememberedCardRaw("u1:payments", "payments")).toBeNull();
    expect(readRememberedCardRaw("u2:collections", "collections")).toBeNull();
    expect(localStorage.getItem("other-setting")).toBe("keep");
  });
});

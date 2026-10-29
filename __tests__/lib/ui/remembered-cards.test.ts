// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { clearRememberedCards } from "@/lib/ui/remembered-cards";

// The money cards' old "last version" copies (kept on devices until
// 2026-10-29) are still wiped at logout: money figures mustn't outlive the
// session.

describe("remembered dashboard cards", () => {
  beforeEach(() => localStorage.clear());

  it("logout clears every remembered card and nothing else", () => {
    localStorage.setItem("other-setting", "keep");
    localStorage.setItem("bizh-card:u1:payments", JSON.stringify({ kind: "payments", props: { a: 1 }, savedAt: Date.now() }));
    localStorage.setItem("bizh-card:u2:collections", JSON.stringify({ kind: "collections", props: { b: 2 }, savedAt: Date.now() }));
    clearRememberedCards();
    expect(localStorage.getItem("bizh-card:u1:payments")).toBeNull();
    expect(localStorage.getItem("bizh-card:u2:collections")).toBeNull();
    expect(localStorage.getItem("other-setting")).toBe("keep");
  });
});

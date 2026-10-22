// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// The search for everything (owner, 2026-10-22: "move into the top bar and be
// in the middle"): on a computer an open box in the bar's middle; Ctrl+K (⌘K)
// or "/" reaches it — by the key's place, so a Hebrew layout works — and where
// the box isn't on screen (a phone, a tablet) they open the full search.

vi.mock("next/navigation", () => import("@/__tests__/mocks/next-navigation"));
vi.mock("@/hooks/useCustomerSearchIndex", () => ({ useCustomerSearchIndex: () => ({ search: () => [] }) }));
vi.mock("@/lib/quick-link", () => ({ takeQuickParam: () => null }));
vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ totalResults: 0, groups: [] }), { status: 200 })));

import { GlobalSearch } from "@/components/layout/GlobalSearch";

afterEach(cleanup);

function renderBar() {
  render(
    <>
      <GlobalSearch desktopOnly />
      <GlobalSearch mobileOnly iconOnly />
    </>
  );
}

describe("the search for everything", () => {
  it("the computer's box says what it is, and its shortcut", () => {
    renderBar();
    const box = screen.getByRole("textbox", { name: "חיפוש בכל המערכת" });
    expect(box).toHaveAttribute("aria-keyshortcuts", "Control+K /");
    expect(screen.getByText("Ctrl K")).toBeInTheDocument();
  });

  it("Ctrl+K with the box out of sight (jsdom lays nothing out): the full search opens — on a Hebrew layout too", async () => {
    renderBar();
    await act(async () => {
      fireEvent.keyDown(window, { key: "ל", code: "KeyK", ctrlKey: true });
    });
    expect(await screen.findByText("חיפוש גלובלי")).toBeInTheDocument();
  });

  it("'/' typed in a field is just a character there", async () => {
    renderBar();
    const field = document.createElement("input");
    document.body.appendChild(field);
    await act(async () => {
      fireEvent.keyDown(field, { key: ".", code: "Slash" });
    });
    expect(screen.queryByText("חיפוש גלובלי")).not.toBeInTheDocument();
    field.remove();
  });

  it("'/' anywhere else opens it", async () => {
    renderBar();
    await act(async () => {
      fireEvent.keyDown(document.body, { key: "/", code: "Slash" });
    });
    expect(await screen.findByText("חיפוש גלובלי")).toBeInTheDocument();
  });
});

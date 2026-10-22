// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";

// A detail page's heading in the top bar, on a computer (owner, 2026-10-22:
// "on the detail pages, we put the word, the arrow, and the name, and the two
// buttons into the top bar"): the breadcrumb beside the back arrow, the buttons
// by the bar's icons — still the page's own (its state works from there).

import { TopBarHeading, TOP_BAR_ACTIONS_ID, TOP_BAR_HEADING_ID } from "@/components/layout/TopBarHeading";
import { mountTopBarSlots } from "@/__tests__/mocks/top-bar-slots";

let unmountSlots = () => {};
beforeEach(() => {
  unmountSlots = mountTopBarSlots();
});
afterEach(() => {
  cleanup();
  unmountSlots();
});

function Page({ onEdit }: { onEdit: () => void }) {
  const [count, setCount] = useState(0);
  return (
    <main>
      <TopBarHeading
        section="נכסים"
        href="/properties"
        title="ריבל 29"
        actions={
          <button type="button" onClick={() => (setCount((c) => c + 1), onEdit())}>
            עריכה {count}
          </button>
        }
      />
      <p>תוכן העמוד</p>
    </main>
  );
}

describe("a detail page's heading in the top bar", () => {
  it("'נכסים › ריבל 29' in the bar's slot, its buttons in the other — none of it in the page", () => {
    const onEdit = vi.fn();
    render(<Page onEdit={onEdit} />);
    const heading = within(document.getElementById(TOP_BAR_HEADING_ID) as HTMLElement);
    expect(heading.getByRole("link", { name: "נכסים" })).toHaveAttribute("href", "/properties");
    expect(heading.getByRole("heading", { level: 1 })).toHaveTextContent("ריבל 29");
    const actions = within(document.getElementById(TOP_BAR_ACTIONS_ID) as HTMLElement);
    fireEvent.click(actions.getByRole("button", { name: "עריכה 0" }));
    // The page's own state, from up there.
    expect(actions.getByRole("button", { name: "עריכה 1" })).toBeInTheDocument();
    expect(onEdit).toHaveBeenCalled();
    expect(within(screen.getByRole("main")).queryByRole("heading")).toBeNull();
  });
});

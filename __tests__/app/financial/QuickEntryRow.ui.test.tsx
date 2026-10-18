// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import QuickEntryRow from "@/app/(app)/financial/bank/QuickEntryRow";
import type { Account } from "@/lib/accounts";

// The quick-add bar under the חשבונות register folds down to a small tab and
// opens again (owner, 2026-10-18: "an arrow down to close when not
// necessary"), and stays folded on this computer.

const account: Account = {
  id: "acc1",
  name: "מזרחי עסקי",
  kind: "bank",
  openingBalance: 0,
  openingDate: "2026-07-01",
  isActive: true,
  sortOrder: 0,
  notes: null,
};

const renderBar = () =>
  render(<QuickEntryRow account={account} projects={[]} properties={[]} merchantMemory={{}} onSaved={() => {}} />);

beforeEach(() => {
  localStorage.clear();
});

describe("QuickEntryRow — fold away", () => {
  it("the down arrow folds it to a tab, keeping what was typed; the tab opens it again", () => {
    renderBar();
    fireEvent.change(screen.getByLabelText("תיאור"), { target: { value: "חשמל" } });

    fireEvent.click(screen.getByRole("button", { name: "הסתרת ההוספה המהירה" }));
    expect(screen.queryByLabelText("תיאור")).not.toBeInTheDocument();
    expect(localStorage.getItem("bizh:quickEntryFolded")).toBe("1");

    fireEvent.click(screen.getByRole("button", { name: /הוספה מהירה למזרחי עסקי/ }));
    expect(screen.getByLabelText("תיאור")).toHaveValue("חשמל");
    expect(localStorage.getItem("bizh:quickEntryFolded")).toBeNull();
  });

  it("opens folded when it was left folded", () => {
    localStorage.setItem("bizh:quickEntryFolded", "1");
    renderBar();
    expect(screen.queryByLabelText("תיאור")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /הוספה מהירה למזרחי עסקי/ })).toHaveAttribute("aria-expanded", "false");
  });
});

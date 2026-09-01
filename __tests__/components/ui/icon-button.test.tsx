// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DeleteButton, EditButton, IconButton } from "@/components/ui/icon-button";
import { EditIcon } from "@/components/ui/icons";

// EditButton/DeleteButton are the ONE edit/delete control for the whole app
// (CONTRIBUTING.md): icon-only, Hebrew label lives only in aria-label/title,
// outline styling is a deliberate settled exception. Locking down the
// accessibility + styling contract here so a future edit can't silently
// regress it across every list row in the app.
describe("EditButton", () => {
  it("is icon-only with the Hebrew label as its only accessible name", () => {
    render(<EditButton />);
    const button = screen.getByRole("button", { name: "עריכה" });
    expect(button).toHaveAttribute("title", "עריכה");
    expect(button.textContent).not.toMatch(/עריכה/);
  });

  it("accepts a custom label without changing the glyph", () => {
    render(<EditButton label="עריכת לקוח" />);
    expect(screen.getByRole("button", { name: "עריכת לקוח" })).toBeInTheDocument();
  });

  it("keeps the outline-only styling (no filled/tinted slab)", () => {
    render(<EditButton />);
    const button = screen.getByRole("button", { name: "עריכה" });
    expect(button.className).toContain("border-secondary");
    expect(button.className).toContain("bg-transparent");
  });
});

describe("DeleteButton", () => {
  it("is icon-only with the Hebrew label as its only accessible name", () => {
    render(<DeleteButton />);
    const button = screen.getByRole("button", { name: "מחיקה" });
    expect(button).toHaveAttribute("title", "מחיקה");
  });

  it("keeps the red outline-only styling", () => {
    render(<DeleteButton />);
    const button = screen.getByRole("button", { name: "מחיקה" });
    expect(button.className).toContain("border-destructive");
    expect(button.className).toContain("bg-transparent");
  });

  it("fires onClick when enabled, and never while loading", () => {
    const onClick = vi.fn();
    const { rerender } = render(<DeleteButton onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: "מחיקה" }));
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(<DeleteButton onClick={onClick} loading />);
    const button = screen.getByRole("button", { name: "מחיקה" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("IconButton", () => {
  it("disables the button and swaps to a spinner while loading", () => {
    render(<IconButton icon={EditIcon} label="שמירה" loading />);
    const button = screen.getByRole("button", { name: "שמירה" });
    expect(button).toBeDisabled();
    expect(button.querySelector("svg.animate-spin")).toBeTruthy();
  });
});

// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { AddressLink } from "@/components/ui/address-link";

// Waze only for a street and house number. A city alone, or a street with
// words after the number ("27 בחניה"), sent drivers somewhere random (owner,
// 2026-10-15/16): the tap shows what's saved, to copy into Waze by hand.
// Nothing saved: the mark is grey and does nothing.

describe("AddressLink", () => {
  it("links to Waze for a street and house number", () => {
    render(<AddressLink address="בית שמש | יחזקאל הנביא 27" />);
    expect(screen.getByRole("link").getAttribute("href")).toContain("waze.com/ul?q=");
  });

  it("a street with words after the number shows what's saved, to copy", async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } });
    render(<AddressLink address="בית שמש | יחזקאל הנביא 27 בחניה" city="בית שמש" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "יחזקאל הנביא 27 בחניה, בית שמש" }));
    expect(screen.getByRole("heading", { name: "אין כתובת מלאה לניווט" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "העתקה" }));
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalledWith("הכתובת הועתקה"));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("יחזקאל הנביא 27 בחניה, בית שמש");
  });

  it("a city alone opens the notice too", () => {
    render(<AddressLink address="בית שמש" />);
    fireEvent.click(screen.getByRole("button", { name: "בית שמש" }));
    expect(screen.getByRole("heading", { name: "אין כתובת מלאה לניווט" })).toBeInTheDocument();
  });

  it.each([["empty", null], ["'לא ידוע'", "לא ידוע"]])(
    "nothing saved (%s): a grey Waze mark, and a tap says to save an address",
    (_label, address) => {
      render(
        <AddressLink address={address} aria-label="נווט עם Waze" unavailableClassName="bg-muted">
          <span>icon</span>
        </AddressLink>
      );
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
      const mark = screen.getByRole("button", { name: "נווט עם Waze" });
      expect(mark.className).toContain("bg-muted");
      fireEvent.click(mark);
      expect(screen.getByRole("heading", { name: "אין כתובת שמורה" })).toBeInTheDocument();
      expect(screen.getByText(/כדי להשתמש ב-Waze יש לשמור כתובת/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "העתקה" })).not.toBeInTheDocument();
    }
  );

  it("a tap on the notice doesn't reach the row underneath", () => {
    const rowClick = vi.fn();
    render(
      <div onClick={rowClick}>
        <AddressLink address="ירושלים" />
      </div>
    );
    fireEvent.click(screen.getByRole("button", { name: "ירושלים" }));
    fireEvent.click(screen.getByRole("heading", { name: "אין כתובת מלאה לניווט" }));
    expect(rowClick).not.toHaveBeenCalled();
  });

  it("nothing at all and no children stays plain text", () => {
    render(<AddressLink address="" fallback="—" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

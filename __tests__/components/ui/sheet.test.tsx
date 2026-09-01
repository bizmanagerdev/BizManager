// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

// Sheet is built directly on @radix-ui/react-dialog (not react-popper), so —
// like Dialog/ConfirmDialog — open/close interaction is safe to test fully
// without paying the floating-ui cold-start tax SearchableSelect has.
describe("Sheet", () => {
  it("renders nothing when closed", () => {
    render(
      <Sheet open={false} onOpenChange={() => {}}>
        <SheetContent>
          <SheetTitle>סינון</SheetTitle>
        </SheetContent>
      </Sheet>
    );
    expect(screen.queryByText("סינון")).not.toBeInTheDocument();
  });

  it("shows its content when open, with a close button", () => {
    render(
      <Sheet open onOpenChange={() => {}}>
        <SheetContent>
          <SheetTitle>סינון</SheetTitle>
        </SheetContent>
      </Sheet>
    );
    expect(screen.getByText("סינון")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "סגור" })).toBeInTheDocument();
  });

  it("calls onOpenChange(false) when the close button is clicked", () => {
    const onOpenChange = vi.fn();
    render(
      <Sheet open onOpenChange={onOpenChange}>
        <SheetContent>
          <SheetTitle>סינון</SheetTitle>
        </SheetContent>
      </Sheet>
    );
    fireEvent.click(screen.getByRole("button", { name: "סגור" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("defaults to sliding in from the right", () => {
    render(
      <Sheet open onOpenChange={() => {}}>
        <SheetContent>
          <SheetTitle>סינון</SheetTitle>
        </SheetContent>
      </Sheet>
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain("right-0");
    expect(dialog.className).toContain("slide-in-from-right");
  });

  it("uses the requested side's classes", () => {
    render(
      <Sheet open onOpenChange={() => {}}>
        <SheetContent side="bottom">
          <SheetTitle>סינון</SheetTitle>
        </SheetContent>
      </Sheet>
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain("bottom-0");
    expect(dialog.className).toContain("slide-in-from-bottom");
    expect(dialog.className).not.toContain("right-0");
  });
});

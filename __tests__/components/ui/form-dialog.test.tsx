// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { FormDialog } from "@/components/ui/form-dialog";

// FormDialog is "every create/edit dialog in the app" per its own comment —
// this locks down the two contracts it exists to enforce: one action bar
// (never vanish mid-save), and no cancel button unless explicitly asked for.
describe("FormDialog", () => {
  it("renders the title and submit label, with no cancel button by default", () => {
    render(
      <FormDialog open onOpenChange={() => {}} title="לקוח חדש" onSubmit={() => {}} submitLabel="שמירה">
        <input aria-label="שם" />
      </FormDialog>
    );
    expect(screen.getByRole("heading", { name: "לקוח חדש" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "שמירה" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ביטול" })).not.toBeInTheDocument();
  });

  it("shows the cancel button only when showCancel is set, and it closes without submitting", () => {
    const onOpenChange = vi.fn();
    const onSubmit = vi.fn();
    render(
      <FormDialog
        open
        onOpenChange={onOpenChange}
        title="לקוח חדש"
        onSubmit={onSubmit}
        submitLabel="שמירה"
        showCancel
      >
        <input aria-label="שם" />
      </FormDialog>
    );
    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("calls onSubmit when the form is submitted via the submit button", () => {
    const onSubmit = vi.fn();
    render(
      <FormDialog open onOpenChange={() => {}} title="לקוח חדש" onSubmit={onSubmit} submitLabel="שמירה">
        <input aria-label="שם" />
      </FormDialog>
    );
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("while busy: disables the fields, swaps to the busy label, and blocks closing", () => {
    const onOpenChange = vi.fn();
    render(
      <FormDialog
        open
        onOpenChange={onOpenChange}
        title="לקוח חדש"
        onSubmit={() => {}}
        submitLabel="שמירה"
        busyLabel="שומר..."
        busy
      >
        <input aria-label="שם" />
      </FormDialog>
    );
    expect(screen.getByRole("button", { name: "שומר..." })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "שם" })).toBeDisabled();

    // Never vanish mid-save: Escape would normally close the dialog.
    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("submitDisabled disables the submit button without touching busy state", () => {
    render(
      <FormDialog
        open
        onOpenChange={() => {}}
        title="לקוח חדש"
        onSubmit={() => {}}
        submitLabel="שמירה"
        submitDisabled
      >
        <input aria-label="שם" />
      </FormDialog>
    );
    const button = screen.getByRole("button", { name: "שמירה" });
    expect(button).toBeDisabled();
    // Fields stay enabled — only the submit action itself is gated.
    expect(screen.getByRole("textbox", { name: "שם" })).not.toBeDisabled();
  });

  it("shows the error message when one is passed", () => {
    render(
      <FormDialog
        open
        onOpenChange={() => {}}
        title="לקוח חדש"
        onSubmit={() => {}}
        submitLabel="שמירה"
        error="שגיאת שרת"
      >
        <input aria-label="שם" />
      </FormDialog>
    );
    expect(screen.getByText("שגיאת שרת")).toBeInTheDocument();
  });
});

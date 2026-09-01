// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

describe("ConfirmDialog", () => {
  it("renders nothing when closed", () => {
    render(
      <ConfirmDialog open={false} onOpenChange={() => {}} title="למחוק?" onConfirm={() => {}} />
    );
    expect(screen.queryByText("למחוק?")).not.toBeInTheDocument();
  });

  it("renders the question, context children and default Hebrew button labels", () => {
    render(
      <ConfirmDialog open onOpenChange={() => {}} title="למחוק הזמנה?" onConfirm={() => {}}>
        <p>הזמנה #123</p>
      </ConfirmDialog>
    );
    // The title doubles as the accessible description when none is given
    // (Radix requires a Description; see the component's own comment) — so
    // the question text legitimately appears twice.
    expect(screen.getByRole("heading", { name: "למחוק הזמנה?" })).toBeInTheDocument();
    expect(screen.getByText("הזמנה #123")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ביטול" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "אישור" })).toBeInTheDocument();
  });

  it("calls onConfirm when the confirm button is clicked", () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog open onOpenChange={() => {}} title="למחוק?" onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: "אישור" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onOpenChange(false) when cancel is clicked", () => {
    const onOpenChange = vi.fn();
    render(<ConfirmDialog open onOpenChange={onOpenChange} title="למחוק?" onConfirm={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("disables both buttons and shows a busy confirm label while loading", () => {
    render(
      <ConfirmDialog open onOpenChange={() => {}} title="שומר..." onConfirm={() => {}} loading />
    );
    expect(screen.getByRole("button", { name: "ביטול" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "..." })).toBeDisabled();
  });

  it("never closes itself while loading, even on an outside dismissal", () => {
    const onOpenChange = vi.fn();
    render(
      <ConfirmDialog open onOpenChange={onOpenChange} title="שומר..." onConfirm={() => {}} loading />
    );
    // Radix Dialog fires onOpenChange(false) on Escape; the wrapped handler
    // must swallow it while an action is in flight so the dialog can't vanish
    // mid-save with no feedback to the user.
    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("shows the error message when one is passed", () => {
    render(
      <ConfirmDialog open onOpenChange={() => {}} title="למחוק?" onConfirm={() => {}} error="שגיאת שרת" />
    );
    expect(screen.getByText("שגיאת שרת")).toBeInTheDocument();
  });
});

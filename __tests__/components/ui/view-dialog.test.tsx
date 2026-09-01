// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ViewDialog } from "@/components/ui/view-dialog";

// ViewDialog is FormDialog's read-only sibling: same chrome, but the file's
// own comment is explicit that there is no action bar unless a real action
// needs one — the only contract worth pinning down here.
describe("ViewDialog", () => {
  it("renders the title, description and children with no footer by default", () => {
    render(
      <ViewDialog open onOpenChange={() => {}} title="פרטי הזמנה" description="תצוגה בלבד">
        <p>תוכן ההזמנה</p>
      </ViewDialog>
    );
    expect(screen.getByRole("heading", { name: "פרטי הזמנה" })).toBeInTheDocument();
    expect(screen.getByText("תצוגה בלבד")).toBeInTheDocument();
    expect(screen.getByText("תוכן ההזמנה")).toBeInTheDocument();
    // Only the header's own close X — no action bar with extra buttons.
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("closes via the header X", () => {
    const onOpenChange = vi.fn();
    render(
      <ViewDialog open onOpenChange={onOpenChange} title="פרטי הזמנה">
        <p>תוכן</p>
      </ViewDialog>
    );
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("renders a footer only when one is explicitly passed", () => {
    render(
      <ViewDialog open onOpenChange={() => {}} title="פרטי הזמנה" footer={<button>הדפסה</button>}>
        <p>תוכן</p>
      </ViewDialog>
    );
    expect(screen.getByRole("button", { name: "הדפסה" })).toBeInTheDocument();
  });

  it("renders headerEnd and headerBelow slots", () => {
    render(
      <ViewDialog
        open
        onOpenChange={() => {}}
        title="פרטי הזמנה"
        headerEnd={<span>סטטוס</span>}
        headerBelow={<span>חיפוש</span>}
      >
        <p>תוכן</p>
      </ViewDialog>
    );
    expect(screen.getByText("סטטוס")).toBeInTheDocument();
    expect(screen.getByText("חיפוש")).toBeInTheDocument();
  });
});

// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge } from "@/components/ui/status-badge";
import { STATUS_PILL_CLASSES } from "@/lib/ui/status-color-classes";

describe("StatusBadge", () => {
  it("maps a payment status to its Hebrew label and success styling", () => {
    render(<StatusBadge type="payment" value="paid" />);
    const badge = screen.getByText("שולם");
    expect(badge.className).toContain("border-success");
  });

  it("maps an unpaid payment to danger styling", () => {
    render(<StatusBadge type="payment" value="unpaid" />);
    const badge = screen.getByText("לא שולם");
    expect(badge.className).toContain("border-destructive");
  });

  it("maps a blocked task to danger styling", () => {
    render(<StatusBadge type="task" value="blocked" />);
    expect(screen.getByText("חסום").className).toContain("border-destructive");
  });

  it("falls back to neutral styling for an unrecognized value", () => {
    render(<StatusBadge type="project" value="not-a-real-status" />);
    const badge = screen.getByText("not-a-real-status");
    expect(badge.className).toContain(STATUS_PILL_CLASSES.neutral.split(" ")[1]);
  });

  it("renders the Arabic label when locale=ar", () => {
    render(<StatusBadge type="payment" value="paid" locale="ar" />);
    expect(screen.getByText("مدفوع")).toBeInTheDocument();
  });
});

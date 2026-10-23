// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// A property's description under its address (owner, 2026-10-23: "save the
// money details in the comments or description of the property"): its first
// line as always; the rest — a Canada building's links and down payment —
// under "עוד פרטים", line by line, its links pressable.

import { PropertyDescription } from "@/app/(app)/properties/[id]/PropertyDescription";

afterEach(cleanup);

const TEXT = [
  "בניין בקנדה · בבעלות 25 PLOURDE INC.",
  "שכירות וניהול (Redleaf): https://redleafmanagement.managebuilding.com/manager/app",
  "",
  "Berman: $66,637 USD",
].join("\n");

describe("a property's description", () => {
  it("one line: just the line, nothing to open", () => {
    render(<PropertyDescription text="דירת 3 חדרים" />);
    expect(screen.getByText("דירת 3 חדרים")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("more lines: the first, and the rest under 'עוד פרטים' — its links by their site's name", () => {
    render(<PropertyDescription text={TEXT} />);
    expect(
      screen.getByText("בניין בקנדה · בבעלות 25 PLOURDE INC."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Berman/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /עוד פרטים/ }));
    expect(screen.getByText(/Berman: \$66,637 USD/)).toBeInTheDocument();
    const link = screen.getByRole("link", {
      name: "redleafmanagement.managebuilding.com",
    });
    expect(link).toHaveAttribute(
      "href",
      "https://redleafmanagement.managebuilding.com/manager/app",
    );
    expect(link).toHaveAttribute("target", "_blank");
    fireEvent.click(screen.getByRole("button", { name: /פחות/ }));
    expect(screen.queryByText(/Berman/)).toBeNull();
  });
});

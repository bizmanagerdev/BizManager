// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SummarySection, SummaryRow } from "@/components/ui/summary";

describe("SummaryRow", () => {
  it("shows an em-dash for an empty, null or undefined value", () => {
    render(
      <>
        <SummaryRow label="ריק" value="" />
        <SummaryRow label="נאל" value={null} />
        <SummaryRow label="לא מוגדר" value={undefined} />
      </>
    );
    expect(screen.getAllByText("—")).toHaveLength(3);
  });

  it("prints a numeric 0 as-is, not as an em-dash", () => {
    render(<SummaryRow label="כמות" value={0} />);
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });

  it("prints a real value as given", () => {
    render(<SummaryRow label="שם" value="דוד כהן" />);
    expect(screen.getByText("דוד כהן")).toBeInTheDocument();
  });
});

describe("SummarySection", () => {
  it("renders the title and its rows, with no edit button by default", () => {
    render(
      <SummarySection title="פרטי לקוח">
        <SummaryRow label="שם" value="דוד כהן" />
      </SummarySection>
    );
    expect(screen.getByText("פרטי לקוח")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows an edit button that defaults its label to the section title, and calls onEdit", () => {
    const onEdit = vi.fn();
    render(
      <SummarySection title="פרטי לקוח" onEdit={onEdit}>
        <SummaryRow label="שם" value="דוד כהן" />
      </SummarySection>
    );
    const button = screen.getByRole("button", { name: "עריכת פרטי לקוח" });
    fireEvent.click(button);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("accepts a custom edit label and an editDisabled state", () => {
    const onEdit = vi.fn();
    render(
      <SummarySection title="פרטי לקוח" onEdit={onEdit} editLabel="חזרה לשלב הלקוח" editDisabled>
        <SummaryRow label="שם" value="דוד כהן" />
      </SummarySection>
    );
    const button = screen.getByRole("button", { name: "חזרה לשלב הלקוח" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onEdit).not.toHaveBeenCalled();
  });
});

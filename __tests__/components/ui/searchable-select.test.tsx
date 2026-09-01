// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { SearchableSelect, type SearchableSelectOption } from "@/components/ui/searchable-select";

const CUSTOMERS: SearchableSelectOption[] = [
  { value: "1", label: "דוד כהן" },
  { value: "2", label: "משה לוי" },
  { value: "3", label: "רותי אברהם" },
];

// CONTRIBUTING.md / memory: "every all-customers / all-projects dropdown is
// searchable" — this is the one component every such picker in the app is
// built from. Coverage here is deliberately limited to the CLOSED-state
// trigger-label logic (`triggerLabel`/`isPlaceholder` in the component):
// opening the Radix Popover pulls in floating-ui's positioning engine, whose
// first use in a jsdom test file costs a real ~15-20s one-off transform/
// resolve — acceptable once per suite, not worth paying per assertion here.
// The pure filter/search logic itself belongs in a lib/ helper if it's ever
// extracted; today it's inline, so this is the practical boundary.
describe("SearchableSelect (closed-state contract)", () => {
  it("shows the placeholder when nothing is selected", () => {
    render(
      <SearchableSelect
        options={CUSTOMERS}
        value=""
        onChange={() => {}}
        placeholder="בחירת לקוח"
        ariaLabel="לקוח"
      />
    );
    const trigger = screen.getByRole("button", { name: "לקוח" });
    expect(within(trigger).getByText("בחירת לקוח")).toBeInTheDocument();
  });

  it("shows the selected option's label, not the placeholder", () => {
    render(
      <SearchableSelect
        options={CUSTOMERS}
        value="2"
        onChange={() => {}}
        placeholder="בחירת לקוח"
        ariaLabel="לקוח"
      />
    );
    const trigger = screen.getByRole("button", { name: "לקוח" });
    expect(within(trigger).getByText("משה לוי")).toBeInTheDocument();
    expect(within(trigger).queryByText("בחירת לקוח")).not.toBeInTheDocument();
  });

  it("shows the emptyOptionLabel (not the placeholder) when value is empty and one is given", () => {
    render(
      <SearchableSelect
        options={CUSTOMERS}
        value=""
        onChange={() => {}}
        placeholder="בחירת לקוח"
        emptyOptionLabel="כל הלקוחות"
        ariaLabel="לקוח"
      />
    );
    expect(within(screen.getByRole("button", { name: "לקוח" })).getByText("כל הלקוחות")).toBeInTheDocument();
  });

  it("falls back to the placeholder when the value doesn't match any option", () => {
    render(
      <SearchableSelect
        options={CUSTOMERS}
        value="does-not-exist"
        onChange={() => {}}
        placeholder="בחירת לקוח"
        ariaLabel="לקוח"
      />
    );
    expect(within(screen.getByRole("button", { name: "לקוח" })).getByText("בחירת לקוח")).toBeInTheDocument();
  });

  it("passes the disabled prop through to the trigger", () => {
    render(<SearchableSelect options={CUSTOMERS} value="" onChange={() => {}} disabled ariaLabel="לקוח" />);
    expect(screen.getByRole("button", { name: "לקוח" })).toBeDisabled();
  });
});

// @vitest-environment jsdom
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CurrencyInput } from "@/components/ui/currency-input";

// A controlled wrapper mirrors how every real caller uses CurrencyInput: state
// holds the PLAIN value handed back via onChange, the component re-groups it
// for display. This is the DOM-wiring layer on top of the pure lib/money.ts
// helpers, which already have their own unit tests.
function Controlled({ groupThousands }: { groupThousands?: boolean }) {
  const [value, setValue] = useState("");
  return (
    <CurrencyInput
      data-testid="amount"
      value={value}
      groupThousands={groupThousands}
      onChange={(e) => setValue(e.target.value)}
    />
  );
}

describe("CurrencyInput", () => {
  it("shows the ₪ marker", () => {
    render(<Controlled />);
    expect(screen.getByText("₪")).toBeInTheDocument();
  });

  it("groups thousands as the user types while handing the parent a plain value", async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const el = screen.getByTestId("amount") as HTMLInputElement;

    await user.type(el, "1200000");

    expect(el).toHaveValue("1,200,000");
  });

  it("keeps a decimal point and its digits", async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const el = screen.getByTestId("amount") as HTMLInputElement;

    await user.type(el, "1356.97");

    expect(el).toHaveValue("1,356.97");
  });

  it("does not group when groupThousands is false", async () => {
    const user = userEvent.setup();
    render(<Controlled groupThousands={false} />);
    const el = screen.getByTestId("amount") as HTMLInputElement;

    await user.type(el, "1200000");

    expect(el).toHaveValue("1200000");
  });
});

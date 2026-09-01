// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Input } from "@/components/ui/input";

// Regression coverage for the Samsung/Android WebView bug documented on
// components/ui/input.tsx: a native type="number" silently drops IME-composed
// digits, so the component must always render type="text" underneath.
describe("Input", () => {
  it("never renders a native type=number input", () => {
    render(<Input type="number" data-testid="amount" />);
    const el = screen.getByTestId("amount");
    expect(el).toHaveAttribute("type", "text");
    expect(el).toHaveAttribute("inputmode", "decimal");
  });

  it("normalizes a typed decimal comma to a dot for numeric fields", () => {
    const handleChange = vi.fn();
    render(<Input type="number" data-testid="amount" onChange={handleChange} />);
    const el = screen.getByTestId("amount") as HTMLInputElement;

    fireEvent.change(el, { target: { value: "12,5" } });

    expect(handleChange).toHaveBeenCalledTimes(1);
    expect(handleChange.mock.calls[0][0].target.value).toBe("12.5");
  });

  it("leaves non-numeric types and other values untouched", () => {
    const handleChange = vi.fn();
    render(<Input type="email" data-testid="email" onChange={handleChange} />);
    const el = screen.getByTestId("email");
    expect(el).toHaveAttribute("type", "email");

    fireEvent.change(el, { target: { value: "a,b@example.com" } });
    expect(handleChange.mock.calls[0][0].target.value).toBe("a,b@example.com");
  });

  it("respects an explicit inputMode instead of forcing decimal", () => {
    render(<Input type="number" inputMode="numeric" data-testid="qty" />);
    expect(screen.getByTestId("qty")).toHaveAttribute("inputmode", "numeric");
  });
});

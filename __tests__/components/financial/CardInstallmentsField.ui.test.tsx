// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CardInstallmentsField } from "@/components/financial/CardInstallmentsField";

// The field says exactly what saving will create, so nobody has to work out
// the split or the dates.

describe("CardInstallmentsField", () => {
  it("with one installment, says when the money lands", () => {
    render(<CardInstallmentsField value="1" onChange={() => {}} amount={1000} paymentDate="2026-09-17" />);
    expect(screen.getByText(/נכנס לחשבון ב-10 לחודש הבא/)).toBeTruthy();
  });

  it("with several, says how many payments of how much, from when", () => {
    render(<CardInstallmentsField value="3" onChange={() => {}} amount={1000} paymentDate="2026-09-17" />);
    const hint = screen.getByText(/יירשמו 3 תשלומים/);
    expect(hint.textContent).toContain("333.33");
    // The agorot left over go on the first.
    expect(hint.textContent).toContain("הראשון");
    expect(hint.textContent).toContain("17/09");
  });

  it("flags a count out of range", () => {
    render(<CardInstallmentsField value="40" onChange={() => {}} amount={1000} paymentDate="2026-09-17" />);
    expect(screen.getByText(/בין 1 ל-36/)).toBeTruthy();
    expect(screen.getByLabelText("מספר תשלומים").getAttribute("aria-invalid")).toBe("true");
  });

  it("reports what is typed", () => {
    const onChange = vi.fn();
    render(<CardInstallmentsField value="1" onChange={onChange} amount={1000} paymentDate="2026-09-17" />);
    fireEvent.change(screen.getByLabelText("מספר תשלומים"), { target: { value: "6" } });
    expect(onChange).toHaveBeenCalledWith("6");
  });
});

// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Field } from "@/components/ui/field";

describe("Field", () => {
  it("renders the label associated with its input via htmlFor", () => {
    render(
      <Field label="שם מלא" htmlFor="full-name">
        <input id="full-name" />
      </Field>
    );
    // Associated correctly if the input is reachable by its accessible label.
    expect(screen.getByLabelText("שם מלא")).toBeInTheDocument();
  });

  it("appends a required marker only when required", () => {
    const { rerender } = render(
      <Field label="שם" htmlFor="a">
        <input id="a" />
      </Field>
    );
    expect(screen.queryByText("*")).not.toBeInTheDocument();

    rerender(
      <Field label="שם" htmlFor="a" required>
        <input id="a" />
      </Field>
    );
    expect(screen.getByText("*")).toBeInTheDocument();
  });

  it("shows the hint text when given", () => {
    render(
      <Field label="טלפון" hint="אם שונה מהטלפון" htmlFor="a">
        <input id="a" />
      </Field>
    );
    expect(screen.getByText(/אם שונה מהטלפון/)).toBeInTheDocument();
  });

  it("shows neither a hint nor a required marker by default", () => {
    render(
      <Field label="שם" htmlFor="a">
        <input id="a" />
      </Field>
    );
    expect(screen.getByText("שם").textContent).toBe("שם");
  });
});

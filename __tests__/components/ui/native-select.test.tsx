// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { NativeSelect } from "@/components/ui/native-select";

// Exists to guarantee one look everywhere a native <select> matches the Input
// next to it — see the component's own comment on the 162 hand-styled selects
// this replaced. The height/radius pairing IS the contract.
describe("NativeSelect", () => {
  it("matches Input's height and radius by default", () => {
    render(
      <NativeSelect aria-label="בחירה">
        <option value="a">א</option>
      </NativeSelect>
    );
    const select = screen.getByRole("combobox", { name: "בחירה" });
    expect(select.className).toContain("h-11");
    expect(select.className).toContain("rounded-xl");
  });

  it("uses a denser height and radius when dense", () => {
    render(
      <NativeSelect aria-label="בחירה" dense>
        <option value="a">א</option>
      </NativeSelect>
    );
    const select = screen.getByRole("combobox", { name: "בחירה" });
    expect(select.className).toContain("h-9");
    expect(select.className).toContain("rounded-lg");
    expect(select.className).not.toContain("h-11");
  });

  it("passes native select props through (disabled, options)", () => {
    render(
      <NativeSelect aria-label="בחירה" disabled defaultValue="b">
        <option value="a">א</option>
        <option value="b">ב</option>
      </NativeSelect>
    );
    const select = screen.getByRole("combobox", { name: "בחירה" });
    expect(select).toBeDisabled();
    expect(select).toHaveValue("b");
  });
});

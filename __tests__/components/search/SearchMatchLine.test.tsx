// @vitest-environment jsdom
import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SearchMatchLine } from "@/components/search/SearchMatchLine";

afterEach(cleanup);

describe("SearchMatchLine", () => {
  it("says why a row came up, painted", () => {
    const { container } = render(
      <SearchMatchLine reasons={[{ kind: "amount", label: "תשלום", value: "₪1,447" }]} terms={["1447"]} />
    );
    expect(screen.getByText("תשלום:")).toBeTruthy();
    expect(container.querySelector("mark")?.textContent).toBe("₪1,447");
  });

  it("doesn't repeat what the row already shows (and paints)", () => {
    const { container } = render(
      <SearchMatchLine
        reasons={[{ kind: "text", label: "שם לחשבונית", value: "ברכת הנחל" }]}
        terms={["נחל"]}
        hideLabels={["שם לחשבונית"]}
      />
    );
    expect(container.textContent).toBe("");
  });

  it("nothing to say → nothing drawn", () => {
    const { container } = render(<SearchMatchLine reasons={undefined} terms={[]} />);
    expect(container.textContent).toBe("");
  });
});

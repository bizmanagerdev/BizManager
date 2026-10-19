// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { Painted, SearchReasons, SearchTermsProvider } from "@/components/search/Painted";

// A list sets its search words once; every bit of text inside paints itself.

afterEach(cleanup);

function marks(container: HTMLElement) {
  return Array.from(container.querySelectorAll("mark")).map((mark) => mark.textContent);
}

describe("Painted / SearchReasons", () => {
  it("paints what the search around it matched", () => {
    const { container } = render(
      <SearchTermsProvider terms={["1447", "050-1234567"]}>
        <Painted text="₪1,447" />
        <Painted text="0501234567" />
      </SearchTermsProvider>
    );
    expect(marks(container)).toEqual(["1,447", "0501234567"]);
  });

  it("no search → plain text, and no reasons line", () => {
    const { container } = render(
      <SearchTermsProvider terms={null}>
        <Painted text="₪1,447" />
        <SearchReasons reasons={[{ kind: "text", label: "הערה", value: "1447" }]} />
      </SearchTermsProvider>
    );
    expect(container.textContent).toBe("₪1,447");
    expect(marks(container)).toEqual([]);
  });

  it("while searching, says why — minus what the row already shows", () => {
    const { container } = render(
      <SearchTermsProvider terms={["הובלה"]}>
        <SearchReasons
          reasons={[
            { kind: "text", label: "מקור", value: "הובלה קרישבסקי" },
            { kind: "amount", label: "סכום", value: "₪5,500" },
          ]}
          hideLabels={["סכום"]}
        />
      </SearchTermsProvider>
    );
    expect(container.textContent).toBe("מקור: הובלה קרישבסקי");
    expect(marks(container)).toEqual(["הובלה"]);
  });
});

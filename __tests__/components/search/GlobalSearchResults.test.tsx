// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { GlobalSearchResults, searchHref } from "@/components/search/GlobalSearchResults";
import type { GlobalSearchResponse } from "@/lib/global-search";

vi.mock("@/components/layout/TopNavigationProgress", () => ({ emitNavigationStart: () => {} }));

afterEach(cleanup);

const response: GlobalSearchResponse = {
  query: "1000 זופניק",
  totalResults: 17,
  terms: ["1000", "זופניק"],
  understood: [{ kind: "amount", value: "1000" }],
  corrections: [],
  groups: [
    {
      key: "customer",
      label: "לקוחות",
      total: 1,
      results: [
        {
          id: "c1",
          group: "customer",
          groupLabel: "לקוחות",
          title: "הלר אבא",
          subtitle: "ירושלים",
          meta: [{ text: "0504152270" }],
          href: "/customers/c1",
          reasons: [{ kind: "text", label: "סניף", value: "אהל זופניק" }],
          rank: 3,
        },
      ],
    },
    {
      key: "expense",
      label: "הוצאות",
      total: 16,
      results: [
        {
          id: "e1",
          group: "expense",
          groupLabel: "הוצאות",
          title: "מקוה זופניק",
          subtitle: null,
          meta: [{ text: "₪1,000", hit: true }, { text: "15/10/26" }],
          href: "/financial?focus=expense%3Ae1",
          reasons: [{ kind: "date", label: "תאריך הוצאה", value: "15/10/26" }],
          rank: 2,
        },
      ],
    },
  ],
};

describe("GlobalSearchResults", () => {
  it("says how many, and what was understood", () => {
    render(<GlobalSearchResults results={response} />);
    expect(screen.getByText("17 תוצאות")).toBeTruthy();
    expect(screen.getByText("סכום ₪1,000")).toBeTruthy();
  });

  it("paints the matched word in the title and in the reason line", () => {
    const { container } = render(<GlobalSearchResults results={response} />);
    const marks = Array.from(container.querySelectorAll("mark")).map((mark) => mark.textContent);
    expect(marks).toContain("זופניק");
    expect(marks).toContain("15/10/26"); // a date reason is painted whole
  });

  it("paints the amount chip that matched", () => {
    render(<GlobalSearchResults results={response} />);
    expect(screen.getByText("₪1,000").className).toContain("bg-yellow");
  });

  it("links each result to its record, and a big group to all of it", () => {
    const { container } = render(<GlobalSearchResults results={response} />);
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/customers/c1");
    expect(hrefs).toContain("/financial?focus=expense%3Ae1");
    expect(hrefs).toContain(searchHref("1000 זופניק", "expense"));
    expect(screen.getByText("הצג את כל 16")).toBeTruthy();
  });
});

// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SectionCard } from "@/components/ui/section-card";

describe("SectionCard", () => {
  it("renders the icon, title and children", () => {
    render(
      <SectionCard icon={<span data-testid="icon" />} title="פרטי פרויקט">
        <p>תוכן</p>
      </SectionCard>
    );
    expect(screen.getByTestId("icon")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "פרטי פרויקט" })).toBeInTheDocument();
    expect(screen.getByText("תוכן")).toBeInTheDocument();
  });

  it("renders the aside slot only when given", () => {
    const { rerender } = render(
      <SectionCard icon={<span />} title="פרטים">
        <p>תוכן</p>
      </SectionCard>
    );
    expect(screen.queryByTestId("aside")).not.toBeInTheDocument();

    rerender(
      <SectionCard icon={<span />} title="פרטים" aside={<button data-testid="aside">+</button>}>
        <p>תוכן</p>
      </SectionCard>
    );
    expect(screen.getByTestId("aside")).toBeInTheDocument();
  });
});

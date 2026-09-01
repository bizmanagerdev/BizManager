// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CollapsibleSection } from "@/components/ui/collapsible-section";

function content(button: HTMLElement) {
  const id = button.getAttribute("aria-controls")!;
  return document.getElementById(id)!;
}

describe("CollapsibleSection", () => {
  it("respects defaultOpen", () => {
    render(
      <CollapsibleSection title="הכנסות" defaultOpen>
        <p>תוכן</p>
      </CollapsibleSection>
    );
    expect(screen.getByRole("button", { name: "כיווץ" })).toBeInTheDocument();
  });

  it("defaults to closed", () => {
    render(
      <CollapsibleSection title="הכנסות">
        <p>תוכן</p>
      </CollapsibleSection>
    );
    const toggle = screen.getByRole("button", { name: "הרחבה" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(content(toggle).className).toContain("hidden");
  });

  it("toggles open and closed on click", () => {
    render(
      <CollapsibleSection title="הכנסות">
        <p>תוכן</p>
      </CollapsibleSection>
    );
    fireEvent.click(screen.getByRole("button", { name: "הרחבה" }));
    const opened = screen.getByRole("button", { name: "כיווץ" });
    expect(opened).toHaveAttribute("aria-expanded", "true");
    expect(content(opened).className).not.toContain("hidden");

    fireEvent.click(opened);
    expect(screen.getByRole("button", { name: "הרחבה" })).toHaveAttribute("aria-expanded", "false");
  });

  it("shows the summary value next to the title, including a literal 0", () => {
    const { rerender } = render(
      <CollapsibleSection title="הכנסות" summary="₪5,000">
        <p>תוכן</p>
      </CollapsibleSection>
    );
    expect(screen.getByText("₪5,000")).toBeInTheDocument();

    rerender(
      <CollapsibleSection title="הכנסות" summary={0}>
        <p>תוכן</p>
      </CollapsibleSection>
    );
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("openWhenEmptyKnown auto-opens once data arrives, unless the reader already toggled it", () => {
    const { rerender } = render(
      <CollapsibleSection title="תזכורות" openWhenEmptyKnown={false}>
        <p>תוכן</p>
      </CollapsibleSection>
    );
    expect(screen.getByRole("button", { name: "הרחבה" })).toBeInTheDocument();

    // Data arrives: there ARE reminders now — the section opens itself.
    rerender(
      <CollapsibleSection title="תזכורות" openWhenEmptyKnown={true}>
        <p>תוכן</p>
      </CollapsibleSection>
    );
    expect(screen.getByRole("button", { name: "כיווץ" })).toBeInTheDocument();
  });

  it("a manual toggle overrides openWhenEmptyKnown from then on", () => {
    render(
      <CollapsibleSection title="תזכורות" openWhenEmptyKnown={true}>
        <p>תוכן</p>
      </CollapsibleSection>
    );
    // Reader closes it even though the data says "open".
    fireEvent.click(screen.getByRole("button", { name: "כיווץ" }));
    expect(screen.getByRole("button", { name: "הרחבה" })).toBeInTheDocument();
  });

  it("collapsible=false forces it open with no chevron, and the header isn't clickable", () => {
    render(
      <CollapsibleSection title="פרטים" collapsible={false}>
        <p>תוכן</p>
      </CollapsibleSection>
    );
    // No chevron button at all.
    expect(screen.queryByRole("button", { name: "כיווץ" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "הרחבה" })).not.toBeInTheDocument();
    // The title row itself is a disabled (non-functional) button.
    expect(screen.getByText("פרטים").closest("button")).toBeDisabled();
    expect(screen.getByText("תוכן")).toBeVisible();
  });

  it("auto-opens on mount when the current location hash matches its id", () => {
    window.location.hash = "#section-a";
    render(
      <CollapsibleSection id="section-a" title="פרטים">
        <p>תוכן</p>
      </CollapsibleSection>
    );
    expect(screen.getByRole("button", { name: "כיווץ" })).toBeInTheDocument();
    window.location.hash = "";
  });

  it("opens in response to a hashchange event after mount", () => {
    window.location.hash = "";
    render(
      <CollapsibleSection id="section-b" title="פרטים">
        <p>תוכן</p>
      </CollapsibleSection>
    );
    expect(screen.getByRole("button", { name: "הרחבה" })).toBeInTheDocument();

    window.location.hash = "#section-b";
    fireEvent(window, new Event("hashchange"));

    expect(screen.getByRole("button", { name: "כיווץ" })).toBeInTheDocument();
    window.location.hash = "";
  });
});

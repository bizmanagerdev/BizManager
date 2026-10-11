// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { CallIconButton } from "@/components/ui/contact-link";

// The order and project cards open on a tap anywhere; the call button sits on
// them and must never open the card too (owner, 2026-10-11: a tap meant for the
// order opened the dialer "half the times").
describe("CallIconButton", () => {
  it("is labelled for the customer and keeps its tap and keys from the card under it", async () => {
    // A computer (mouse): the button copies the number instead of dialing.
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const matchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({ ...matchMedia(query), matches: true })) as typeof window.matchMedia;
    const openCard = vi.fn();
    const pressCard = vi.fn();
    render(
      <div tabIndex={0} onClick={openCard} onKeyDown={openCard} onPointerDown={pressCard}>
        <CallIconButton phone="052-123 4567" name="משכן משה" />
      </div>
    );
    // A real tel: link — a phone's dialer opens from it the way the old number did.
    const button = screen.getByRole("link", { name: "חיוג אל משכן משה" });
    expect(button.getAttribute("href")).toBe("tel:0521234567");
    await act(async () => {
      fireEvent.pointerDown(button);
      fireEvent.click(button);
      fireEvent.keyDown(button, { key: "Enter" });
    });
    expect(pressCard).not.toHaveBeenCalled();
    expect(openCard).not.toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledWith("052-123 4567");
    window.matchMedia = matchMedia;
    Reflect.deleteProperty(navigator, "clipboard");
  });
});

import { describe, it, expect } from "vitest";
import { whatsappHref } from "@/lib/whatsapp";

describe("whatsappHref", () => {
  it("folds a leading 0 to the 972 country code", () => {
    expect(whatsappHref("052-123-4567")).toBe("https://wa.me/972521234567");
  });
  it("strips formatting from an already-international number", () => {
    expect(whatsappHref("+972 52 1234567")).toBe("https://wa.me/972521234567");
  });
  it("prefixes 972 onto a bare local number with no leading 0", () => {
    expect(whatsappHref("521234567")).toBe("https://wa.me/972521234567");
  });
  it("appends and URL-encodes a prefilled message when given one", () => {
    expect(whatsappHref("0521234567", "שלום, מתי נוח?")).toBe(
      `https://wa.me/972521234567?text=${encodeURIComponent("שלום, מתי נוח?")}`
    );
  });
  it("omits ?text= entirely with no message (not even an empty one)", () => {
    const href = whatsappHref("0521234567");
    expect(href).not.toContain("?text=");
  });
  it("returns null for no number / a number with no digits at all", () => {
    expect(whatsappHref(null)).toBeNull();
    expect(whatsappHref(undefined)).toBeNull();
    expect(whatsappHref("")).toBeNull();
    expect(whatsappHref("---")).toBeNull();
  });
});

import { describe, it, expect, vi, afterEach } from "vitest";
import { expiryStatus } from "@/lib/vehicles";

// A vehicle's dates and a document's dates are the same question, so they get
// the same answer. This used to be a second implementation with its own wording
// and its own idea of when "today" ends.
describe("vehicle expiryStatus", () => {
  afterEach(() => vi.useRealTimers());

  const at = (iso: string) => vi.setSystemTime(new Date(`${iso}T09:00:00+03:00`));

  it("speaks the same Hebrew as a document badge", () => {
    vi.useFakeTimers();
    at("2026-09-24");
    expect(expiryStatus("2026-09-25")).toMatchObject({ tone: "warning", label: "עוד יום אחד" });
    expect(expiryStatus("2026-09-26")).toMatchObject({ tone: "warning", label: "עוד יומיים" });
    expect(expiryStatus("2026-09-29")).toMatchObject({ tone: "warning", label: "עוד 5 ימים" });
  });

  it("separates expired from expiring today", () => {
    vi.useFakeTimers();
    at("2026-09-24");
    expect(expiryStatus("2026-09-23")).toMatchObject({ tone: "destructive", label: "פג תוקף" });
    expect(expiryStatus("2026-09-24")).toMatchObject({ tone: "destructive", label: "פג היום" });
  });

  it("keeps the בתוקף state a car's rows rely on", () => {
    // All three dates are always on screen for a vehicle, so a blank beside
    // "טסט" would read as unknown rather than as fine.
    vi.useFakeTimers();
    at("2026-09-24");
    expect(expiryStatus("2027-09-24")).toMatchObject({ tone: "success", label: "בתוקף" });
  });

  it("uses the Israeli day, not the machine's", () => {
    // 23:30 in Israel on the 24th is still the 24th, even though UTC has
    // already rolled over. Judged by UTC, a test due that day reads as expired.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-24T20:30:00Z")); // 23:30 Asia/Jerusalem
    expect(expiryStatus("2026-09-24")).toMatchObject({ label: "פג היום" });
  });

  it("says nothing when there is no date", () => {
    expect(expiryStatus(null)).toBeNull();
    expect(expiryStatus("")).toBeNull();
    expect(expiryStatus("not a date")).toBeNull();
  });
});

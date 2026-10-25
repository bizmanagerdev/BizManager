// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The page's error screen keeps what went wrong for Sentry when the report
// can't go out now — with no connection, and on a saved copy, where the server
// isn't answering while the device may still say it's online (owner's test,
// 2026-10-25: a property's saved copy crashed, and nothing reached Sentry).

vi.mock("@/lib/sentry-lazy", () => ({ withSentry: () => {} }));
vi.mock("@/lib/ui/auto-recover", () => ({ reloadIfStaleBuild: () => {} }));

import AppError from "@/app/(app)/error";

function setOnline(online: boolean) {
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
}
const notes = () => JSON.parse(localStorage.getItem("bizh-offline-report") ?? "[]") as { what: string; savedCopy?: boolean }[];

beforeEach(() => {
  localStorage.clear();
  setOnline(true);
});
afterEach(() => {
  delete document.documentElement.dataset.bizhSaved;
});

describe("the page's error screen, for the offline report", () => {
  it("a saved copy, the device saying it's online: kept", () => {
    document.documentElement.dataset.bizhSaved = String(Date.now());
    render(<AppError error={new Error("boom")} reset={() => {}} />);
    expect(notes()).toMatchObject([{ what: "page error", savedCopy: true }]);
  });

  it("no connection: kept", () => {
    setOnline(false);
    render(<AppError error={new Error("boom")} reset={() => {}} />);
    expect(notes()).toMatchObject([{ what: "page error", savedCopy: false }]);
  });

  it("online, from the server: reported at once, nothing kept", () => {
    render(<AppError error={new Error("boom")} reset={() => {}} />);
    expect(notes()).toEqual([]);
  });
});

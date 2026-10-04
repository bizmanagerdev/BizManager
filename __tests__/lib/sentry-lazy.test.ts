import { describe, it, expect, vi, beforeEach } from "vitest";

// lib/sentry-lazy caches the SDK import at module level, so each test gets a
// fresh copy of it (and its own fake SDK) via resetModules + doMock.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function loadWithFakeSdk(factory: () => Record<string, unknown>) {
  vi.resetModules();
  vi.doMock("@sentry/nextjs", factory);
  return import("@/lib/sentry-lazy");
}

describe("withSentry", () => {
  beforeEach(() => {
    vi.doUnmock("@sentry/nextjs");
  });

  it("runs reports in the order they were made", async () => {
    const calls: string[] = [];
    const sdk = {
      addBreadcrumb: (c: { message: string }) => calls.push(`crumb:${c.message}`),
      captureMessage: (m: string) => calls.push(`message:${m}`),
    };
    const { withSentry } = await loadWithFakeSdk(() => sdk);

    withSentry((S) => S.addBreadcrumb({ message: "first" }));
    withSentry((S) => S.captureMessage("second"));
    withSentry((S) => S.addBreadcrumb({ message: "third" }));
    await flush();

    expect(calls).toEqual(["crumb:first", "message:second", "crumb:third"]);
  });

  it("never throws into the caller, even when a report throws", async () => {
    const captureMessage = vi.fn();
    const { withSentry } = await loadWithFakeSdk(() => ({ captureMessage }));

    expect(() =>
      withSentry(() => {
        throw new Error("report blew up");
      })
    ).not.toThrow();
    withSentry((S) => S.captureMessage("still reported"));
    await flush();

    expect(captureMessage).toHaveBeenCalledWith("still reported");
  });

  it("loads the SDK once, however many reports are made", async () => {
    const factory = vi.fn(() => ({ setTag: vi.fn() }));
    const { withSentry } = await loadWithFakeSdk(factory);

    for (let i = 0; i < 5; i++) withSentry((S) => S.setTag("i", String(i)));
    await flush();

    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("uses an SDK handed over by provideSentry without importing it", async () => {
    const factory = vi.fn(() => ({ captureMessage: vi.fn() }));
    const { withSentry, provideSentry } = await loadWithFakeSdk(factory);
    const provided = { captureMessage: vi.fn() };

    provideSentry(provided as unknown as typeof import("@sentry/nextjs"));
    withSentry((S) => S.captureMessage("from the browser"));
    await flush();

    expect(provided.captureMessage).toHaveBeenCalledWith("from the browser");
    expect(factory).not.toHaveBeenCalled();
  });

  it("drops reports quietly when the SDK cannot be loaded", async () => {
    const { withSentry } = await loadWithFakeSdk(() => {
      throw new Error("chunk load failed");
    });
    const report = vi.fn();

    expect(() => withSentry(report)).not.toThrow();
    await flush();

    expect(report).not.toHaveBeenCalled();
  });
});

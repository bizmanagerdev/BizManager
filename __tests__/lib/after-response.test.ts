import { describe, it, expect, vi, beforeEach } from "vitest";

const { after, captureException } = vi.hoisted(() => ({
  after: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock("next/server", () => ({ after }));
vi.mock("@sentry/nextjs", () => ({ captureException }));

import { runAfterResponse } from "@/lib/after-response";

beforeEach(() => {
  after.mockReset();
  captureException.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("runAfterResponse", () => {
  it("in a request, holds the work until after the response", async () => {
    let deferred: (() => Promise<unknown>) | undefined;
    after.mockImplementation((fn: () => Promise<unknown>) => {
      deferred = fn;
    });
    const task = vi.fn(async () => {});

    runAfterResponse("test", task);
    expect(task).not.toHaveBeenCalled();

    await deferred?.();
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("outside a request (after() throws), starts the work right away", () => {
    after.mockImplementation(() => {
      throw new Error("`after` was called outside a request scope");
    });
    const task = vi.fn(async () => {});

    runAfterResponse("test", task);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("reports a failure to Sentry instead of throwing — the save already succeeded", async () => {
    let deferred: (() => Promise<unknown>) | undefined;
    after.mockImplementation((fn: () => Promise<unknown>) => {
      deferred = fn;
    });
    const boom = new Error("push failed");

    runAfterResponse("tasks/create notify", async () => {
      throw boom;
    });
    await expect(deferred?.()).resolves.toBeUndefined();
    expect(captureException).toHaveBeenCalledWith(boom, { tags: { after_response: "tasks/create notify" } });
  });
});

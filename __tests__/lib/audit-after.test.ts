import { describe, it, expect, vi, beforeEach } from "vitest";

const { logAuditEvent, after } = vi.hoisted(() => ({
  logAuditEvent: vi.fn(async () => {}),
  after: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({ logAuditEvent }));
vi.mock("next/server", () => ({ after }));

import { logAuditEventAfterResponse } from "@/lib/audit-after";

const PARAMS = {
  supabase: {} as never,
  tableName: "expenses",
  recordId: "e1",
  action: "create",
  changedBy: "u1",
  userRole: "worker",
};

beforeEach(() => {
  logAuditEvent.mockClear();
  after.mockReset();
});

describe("logAuditEventAfterResponse", () => {
  it("in a request, defers the write until after the response", async () => {
    let deferred: (() => unknown) | undefined;
    after.mockImplementation((fn: () => unknown) => {
      deferred = fn;
    });

    logAuditEventAfterResponse(PARAMS);
    expect(logAuditEvent).not.toHaveBeenCalled();

    await deferred?.();
    expect(logAuditEvent).toHaveBeenCalledWith(PARAMS);
  });

  it("outside a request (after() throws), still writes the log right away", () => {
    after.mockImplementation(() => {
      throw new Error("`after` was called outside a request scope");
    });

    logAuditEventAfterResponse(PARAMS);
    expect(logAuditEvent).toHaveBeenCalledWith(PARAMS);
  });
});

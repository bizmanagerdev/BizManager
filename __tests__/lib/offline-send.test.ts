// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The property and rent pages' changes — a check נפרע or חזר, an income
// edited, a delete — go through the send queue, so they save with no signal
// too (owner, 2026-10-24): done once the server has them, or once they're kept
// on the device. A delete of what's already gone did what it was meant to —
// sent again because its slow first try did arrive after all.

import { sendChange } from "@/lib/offline-send";
import {
  getFailedLength,
  getQueueLength,
  processQueue,
} from "@/lib/offline-queue";

let online = true;
const sent: string[] = [];
let answer: (url: string) => Response = () => json(200, { ok: true });

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  localStorage.clear();
  online = true;
  sent.length = 0;
  answer = () => json(200, { ok: true });
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    get: () => online,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      sent.push(url);
      return answer(url);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a change through the send queue", () => {
  it("no signal: kept on the device — done for the page, sent later", async () => {
    online = false;
    const result = await sendChange(
      "/api/payments/mark-collected",
      { id: "p1", collected: true },
      "צ׳ק נפרע",
      "x",
    );
    expect(result).toEqual({ ok: true, queued: true, data: null });
    expect(sent).toEqual([]);
    expect(getQueueLength()).toBe(1);

    online = true;
    await processQueue();
    expect(sent).toEqual(["/api/payments/mark-collected"]);
    expect(getQueueLength()).toBe(0);
  });

  it("the server has it: done, with its answer", async () => {
    const result = await sendChange(
      "/api/payments/update",
      { id: "p1" },
      "עדכון הכנסה",
      "x",
    );
    expect(result).toEqual({ ok: true, queued: false, data: { ok: true } });
  });

  it("a delete of what's already gone: done", async () => {
    answer = () => json(404, { error: "Payment not found" });
    expect(
      await sendChange("/api/payments/delete", { id: "p1" }, "מחיקה", "x"),
    ).toMatchObject({ ok: true });
  });

  it("refused: not done, in Hebrew", async () => {
    answer = () => json(400, { error: "החשבון אינו תקין." });
    expect(
      await sendChange("/api/payments/update", { id: "p1" }, "עדכון", "נכשל"),
    ).toEqual({
      ok: false,
      error: "החשבון אינו תקין.",
    });
  });
});

describe("the queue sending what waited", () => {
  it("a delete answered 'not found' is done, not failed; anything else not found still fails", async () => {
    online = false;
    await sendChange("/api/expenses/delete", { id: "e1" }, "מחיקת הוצאה", "x");
    await sendChange(
      "/api/payments/update",
      { id: "gone" },
      "עדכון הכנסה",
      "x",
    );
    online = true;
    answer = () => json(404, { error: "not found" });
    const result = await processQueue();
    expect(result.processed).toBe(1);
    expect(getQueueLength()).toBe(0);
    expect(getFailedLength()).toBe(1);
  });
});

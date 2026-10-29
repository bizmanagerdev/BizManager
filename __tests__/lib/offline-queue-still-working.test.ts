// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A save sent again while its first send is still being worked on is answered
// "still working — send it again shortly" (lib/idempotency.ts). It used to be
// a 202, taken as sent: a save whose first send then failed was lost (audit
// 2026-10-27). Now it stays on the phone, isn't counted as a failed try, and
// goes again a few seconds later with the same key.

const sent: Array<{ url: string; key: string | undefined }> = [];
let answers: Response[] = [];
let online = true;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const stillWorking = () => json(503, { error: "השמירה עדיין מתבצעת.", pending: true });

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  localStorage.clear();
  sent.length = 0;
  answers = [];
  online = true;
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      sent.push({ url, key: (init.headers as Record<string, string>)["Idempotency-Key"] });
      return answers.shift() ?? json(200, { ok: true, id: "r1" });
    })
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("answered 'still working'", () => {
  it("sent now (another tab sent it too): kept on the phone, and sent again shortly with the same key", async () => {
    const queue = await import("@/lib/offline-queue");
    answers = [stillWorking()];

    const result = await queue.offlineFetch("/api/attendance/my/start", { notes: null }, "פתיחת המשמרת", { idempotent: true });

    expect(result).toMatchObject({ queued: true, reason: "slow" });
    expect(queue.getQueueLength()).toBe(1);
    expect(queue.getFailedLength()).toBe(0);

    await vi.advanceTimersByTimeAsync(10_000);

    expect(sent).toHaveLength(2);
    expect(sent[1].key).toBe(sent[0].key);
    expect(queue.getQueueLength()).toBe(0);
  });

  it("from the queue: waits, never counted as a failed try — however many times it's answered so", async () => {
    const queue = await import("@/lib/offline-queue");
    online = false;
    await queue.offlineFetch("/api/payments/create", { amount: 100 }, "תשלום", { idempotent: true });
    online = true;

    for (let i = 0; i < 8; i++) {
      answers.push(stillWorking());
      await queue.processQueue();
    }
    expect(queue.getQueueLength()).toBe(1);
    expect(queue.getFailedLength()).toBe(0);
    expect(queue.getQueue()[0].attempts).toBe(0);

    // Its first send has finished: the resend gets its answer, and it's done.
    await queue.processQueue();
    expect(queue.getQueueLength()).toBe(0);
    expect(new Set(sent.map((s) => s.key)).size).toBe(1);
  });

  it("a plain server error still counts as a failed try", async () => {
    const queue = await import("@/lib/offline-queue");
    online = false;
    await queue.offlineFetch("/api/payments/create", { amount: 100 }, "תשלום", { idempotent: true });
    online = true;

    answers = [json(503, { error: "down" })];
    await queue.processQueue();
    expect(queue.getQueue()[0].attempts).toBe(1);
  });
});

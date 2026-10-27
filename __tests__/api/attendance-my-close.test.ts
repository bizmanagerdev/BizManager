import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/attendance/my/close — the worker's own clock-out. The phone sends
// a close again when it never heard the answer (weak signal: the close arrived,
// the reply didn't), from its send queue, hours or days later. סאלח's phone
// showed two such repeats as failed for good (Sentry, 24–25/10) though both
// shifts were closed. A repeat is "done"; it never closes another shift.

const { requireRouteAccess } = vi.hoisted(() => ({ requireRouteAccess: vi.fn() }));

vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));
vi.mock("@/lib/audit-after", () => ({ logAuditEventAfterResponse: vi.fn() }));
vi.mock("@/lib/i18n/translateToHebrew", () => ({ translateToHebrew: vi.fn(async () => null) }));

import { POST } from "@/app/api/attendance/my/close/route";

type Report = { id: string; user_id: string; status: string; clock_in: string; clock_out: string | null; notes: string | null };

/** Just enough of Supabase for this route: filters, one row, and updates by id. */
function fakeSupabase(rows: Report[]) {
  const updates: Array<{ id: string; values: Record<string, unknown> }> = [];
  const from = () => {
    const filters: Array<(row: Report) => boolean> = [];
    let update: Record<string, unknown> | null = null;
    const builder = {
      select: () => builder,
      eq: (col: keyof Report, value: unknown) => {
        // Timestamps compare as moments, as Postgres does.
        filters.push((row) =>
          col === "clock_out" || col === "clock_in"
            ? row[col] !== null && Date.parse(row[col] as string) === Date.parse(String(value))
            : row[col] === value
        );
        return builder;
      },
      neq: (col: keyof Report, value: unknown) => {
        filters.push((row) => row[col] !== value);
        return builder;
      },
      limit: () => builder,
      update: (values: Record<string, unknown>) => {
        update = values;
        return builder;
      },
      maybeSingle: async () => {
        const row = rows.find((r) => filters.every((f) => f(r))) ?? null;
        if (update && row) {
          updates.push({ id: row.id, values: update });
          Object.assign(row, update);
        }
        return { data: row, error: null };
      },
    };
    return builder;
  };
  return { supabase: { from }, updates };
}

function as(rows: Report[]) {
  const db = fakeSupabase(rows);
  requireRouteAccess.mockResolvedValue({
    ok: true,
    value: { supabase: db.supabase, profile: { id: "w1", role: "worker", locale: "he" } },
  });
  return db;
}

function post(body: unknown) {
  return POST(new Request("http://test/api/attendance/my/close", { method: "POST", body: JSON.stringify(body) }));
}

// סאלח's 22/10 shift, closed on 22/10 at 19:41:23.853 (UTC).
const CLOSED_22: Report = {
  id: "r22",
  user_id: "w1",
  status: "pending_review",
  clock_in: "2026-10-22T05:39:03.854Z",
  clock_out: "2026-10-22T19:41:23.853Z",
  notes: "בית שמש",
};
// His 25/10 shift, open from 08:36.
const OPEN_25: Report = {
  id: "r25",
  user_id: "w1",
  status: "open",
  clock_in: "2026-10-25T08:36:29.340Z",
  clock_out: null,
  notes: null,
};

beforeEach(() => {
  requireRouteAccess.mockReset();
  vi.useFakeTimers({ now: new Date("2026-10-25T14:48:46Z"), toFake: ["Date"] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/attendance/my/close", () => {
  it("closes the shift it names and sends it for approval", async () => {
    const db = as([{ ...OPEN_25 }]);
    const res = await post({ report_id: "r25", clock_out: "2026-10-25T14:40:00.000Z", notes: "הובלה" });
    expect(res.status).toBe(200);
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0]).toMatchObject({
      id: "r25",
      values: { status: "pending_review", clock_out: "2026-10-25T14:40:00.000Z", notes: "הובלה" },
    });
  });

  it("answers a repeat of a close that already arrived as done", async () => {
    const db = as([{ ...CLOSED_22 }]);
    const res = await post({ report_id: "r22", clock_out: CLOSED_22.clock_out });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, repeat: true, session: { id: "r22" } });
    expect(db.updates).toHaveLength(0);
  });

  it("answers a repeat as done while a newer shift is open, and leaves that shift open", async () => {
    const db = as([{ ...CLOSED_22 }, { ...OPEN_25 }]);
    const res = await post({ report_id: "r22", clock_out: CLOSED_22.clock_out });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ repeat: true, session: { id: "r22" } });
    expect(db.updates).toHaveLength(0);
  });

  it("never closes a different shift than the one it names", async () => {
    // The named shift is gone (removed by the office); another one is open,
    // and the end time would fit it.
    const db = as([{ ...OPEN_25 }]);
    const res = await post({ report_id: "removed", clock_out: "2026-10-25T14:40:00.000Z" });
    expect(res.status).toBe(404);
    expect(db.updates).toHaveLength(0);
  });

  it("recognises a close queued before closes named their shift, by its end time", async () => {
    const db = as([{ ...CLOSED_22 }]);
    const res = await post({ clock_out: CLOSED_22.clock_out, notes: "בית שמש" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ repeat: true, session: { id: "r22" } });
    expect(db.updates).toHaveLength(0);
  });

  it("recognises such a close even with the next shift open (its end is before that shift's start)", async () => {
    const db = as([{ ...CLOSED_22 }, { ...OPEN_25 }]);
    const res = await post({ clock_out: CLOSED_22.clock_out });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ repeat: true, session: { id: "r22" } });
    expect(db.updates).toHaveLength(0);
  });

  it("still refuses when no shift is open and nothing was closed at that time", async () => {
    const db = as([{ ...CLOSED_22 }]);
    const res = await post({ clock_out: "2026-10-25T14:40:00.000Z" });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "אין לך משמרת פתוחה." });
    expect(db.updates).toHaveLength(0);
  });

  it("still refuses an end before the start of the open shift when it's not a repeat", async () => {
    const db = as([{ ...OPEN_25 }]);
    const res = await post({ report_id: "r25", clock_out: "2026-10-25T08:00:00.000Z" });
    expect(res.status).toBe(400);
    expect(db.updates).toHaveLength(0);
  });
});

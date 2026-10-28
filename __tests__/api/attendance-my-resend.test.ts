import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A worker's clock-in and whole-shift report always go through the phone's
// send queue with a key (audit 2026-10-27). On a weak signal the save can
// arrive while its answer doesn't, and the phone sends it again with the same
// key: the server answers that resend with the first answer — never a second
// shift, and never "already open" / "already reported" for the worker's own
// save. A real clash (a different press) is refused as before.

const { requireRouteAccess } = vi.hoisted(() => ({ requireRouteAccess: vi.fn() }));

vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));
vi.mock("@/lib/audit-after", () => ({ logAuditEventAfterResponse: vi.fn() }));
vi.mock("@/lib/i18n/translateToHebrew", () => ({ translateToHebrew: vi.fn(async () => null) }));

import { POST as start } from "@/app/api/attendance/my/start/route";
import { POST as log } from "@/app/api/attendance/my/log/route";

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { code: string; message: string } | null };

/**
 * Just enough of Supabase for these routes and lib/idempotency.ts, over
 * in-memory tables — with the two unique rules that matter here: one row per
 * idempotency key, and one open shift per worker.
 */
function fakeDb(tables: Record<string, Row[]>) {
  const from = (name: string) => {
    const rows = (tables[name] ??= []);
    const filters: Array<(row: Row) => boolean> = [];
    let op: { kind: "select" } | { kind: "insert" | "update"; values: Row } | { kind: "delete" } = { kind: "select" };
    const run = (): Result => {
      if (op.kind === "insert") {
        const values = op.values;
        const duplicate =
          (name === "idempotency_keys" && rows.some((row) => row.key === values.key)) ||
          (name === "phone_attendance_reports" &&
            values.status === "open" &&
            rows.some((row) => row.user_id === values.user_id && row.status === "open"));
        if (duplicate) return { data: null, error: { code: "23505", message: "duplicate key value" } };
        const row = { id: `${name}-${rows.length + 1}`, ...values };
        rows.push(row);
        return { data: row, error: null };
      }
      const matched = rows.filter((row) => filters.every((keep) => keep(row)));
      if (op.kind === "update") {
        for (const row of matched) Object.assign(row, op.values);
        return { data: matched[0] ?? null, error: null };
      }
      if (op.kind === "delete") {
        for (const row of matched) rows.splice(rows.indexOf(row), 1);
        return { data: null, error: null };
      }
      return { data: matched, error: null };
    };
    const builder = {
      select: () => builder,
      insert: (values: Row) => ((op = { kind: "insert", values }), builder),
      update: (values: Row) => ((op = { kind: "update", values }), builder),
      delete: () => ((op = { kind: "delete" }), builder),
      eq: (col: string, value: unknown) => (filters.push((row) => row[col] === value), builder),
      in: (col: string, values: unknown[]) => (filters.push((row) => values.includes(row[col])), builder),
      gte: (col: string, value: string) => (filters.push((row) => String(row[col]) >= value), builder),
      range: () => builder,
      maybeSingle: async () => {
        const result = run();
        return { data: Array.isArray(result.data) ? (result.data[0] ?? null) : result.data, error: result.error };
      },
      then: (resolve: (result: Result) => unknown, reject: (error: unknown) => unknown) =>
        Promise.resolve(run()).then(resolve, reject),
    };
    return builder;
  };
  return { from };
}

let tables: Record<string, Row[]>;
beforeEach(() => {
  tables = {
    users: [{ id: "w1", active: true, payroll_worker_type: "hourly_payslip", pay_tracking_mode: null }],
    phone_attendance_reports: [],
    attendance_sessions: [],
    idempotency_keys: [],
  };
  requireRouteAccess.mockResolvedValue({
    ok: true,
    value: { supabase: fakeDb(tables), profile: { id: "w1", role: "worker", locale: "he" } },
  });
});
afterEach(() => vi.clearAllMocks());

function request(path: string, body: unknown, key?: string) {
  return new Request(`http://test${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) },
    body: JSON.stringify(body),
  });
}

const pressedAt = () => new Date(Date.now() - 60_000).toISOString();

describe("clock-in sent again after its answer was lost", () => {
  it("gets the first answer back, and the worker has one shift", async () => {
    const body = { notes: null, clock_in: pressedAt() };
    const first = await start(request("/api/attendance/my/start", body, "key-1"));
    expect(first.status).toBe(200);
    const firstAnswer = await first.json();
    expect(firstAnswer.ok).toBe(true);

    const again = await start(request("/api/attendance/my/start", body, "key-1"));
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(firstAnswer);
    expect(tables.phone_attendance_reports).toHaveLength(1);
  });

  it("a second press while a shift is open is still refused — and stays refused when sent again", async () => {
    await start(request("/api/attendance/my/start", { notes: null, clock_in: pressedAt() }, "key-1"));

    const second = await start(request("/api/attendance/my/start", { notes: null, clock_in: pressedAt() }, "key-2"));
    expect(second.status).toBe(409);
    expect((await second.json()).error).toBe("כבר יש לך משמרת פתוחה.");
    const secondAgain = await start(request("/api/attendance/my/start", { notes: null, clock_in: pressedAt() }, "key-2"));
    expect(secondAgain.status).toBe(409);
    expect(tables.phone_attendance_reports).toHaveLength(1);
  });

  it("with no key (an older phone), a repeat is refused as before", async () => {
    await start(request("/api/attendance/my/start", { notes: null }));
    const again = await start(request("/api/attendance/my/start", { notes: null }));
    expect(again.status).toBe(409);
  });
});

describe("a whole shift sent again after its answer was lost", () => {
  const shift = () => ({
    notes: "בית שמש",
    clock_in: new Date(Date.now() - 9 * 60 * 60_000).toISOString(),
    clock_out: new Date(Date.now() - 60 * 60_000).toISOString(),
  });

  it("gets the first answer back, not \"already reported\", and is saved once", async () => {
    const body = shift();
    const first = await log(request("/api/attendance/my/log", body, "key-9"));
    expect(first.status).toBe(200);
    const firstAnswer = await first.json();

    const again = await log(request("/api/attendance/my/log", body, "key-9"));
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(firstAnswer);
    expect(tables.phone_attendance_reports).toHaveLength(1);
  });

  it("the same hours reported again by a new press are still refused", async () => {
    const body = shift();
    await log(request("/api/attendance/my/log", body, "key-9"));
    const twice = await log(request("/api/attendance/my/log", body, "key-10"));
    expect(twice.status).toBe(409);
    expect((await twice.json()).error).toBe("כבר קיים דיווח על השעות האלה.");
    expect(tables.phone_attendance_reports).toHaveLength(1);
  });
});

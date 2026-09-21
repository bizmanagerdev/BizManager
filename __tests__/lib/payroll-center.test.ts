import { describe, it, expect } from "vitest";
import {
  buildPeriodBounds,
  calculateSessionLaborCostsByDay,
  collectLockedSessionIds,
  ensureRecentPayslips,
  getCurrentPayrollPeriod,
  getLatestHourlyOverride,
  getPayslipItemsTotal,
  inferSessionBusinessDomain,
  isPayrollPeriodEditable,
  isPayrollPeriodLocked,
  isSessionInPeriod,
  normalizePayrollStatus,
  resolveSessionLaborCost,
} from "@/lib/payroll-center";
import type { SalaryAgreementRow } from "@/lib/payroll";

// Pure-function coverage for lib/payroll-center.ts — the actual payroll
// engine that `payroll/sessions/*` routes call into (and every route test
// mocks away). fetchSalaryCenterProtectedPayload (the big multi-query
// aggregator) and the DB-side recalculation/regeneration functions are left
// for a follow-up — this targets the synchronous computation core, where a
// wrong formula silently pays someone the wrong amount.

function hourlyAgreement(overrides: Partial<SalaryAgreementRow> = {}): SalaryAgreementRow {
  return {
    id: "agr-1",
    user_id: "u1",
    salary_type: "hourly",
    hourly_rate: 50,
    monthly_salary: null,
    valid_from: "2026-01-01",
    valid_to: null,
    notes: null,
    overtime_rate: 75,
    standard_daily_hours: 8,
    ...overrides,
  } as SalaryAgreementRow;
}

describe("normalizePayrollStatus / isPayrollPeriodEditable / isPayrollPeriodLocked", () => {
  it("maps locked/closed/approved to 'locked', 'paid' stays 'paid', anything else (incl. missing) is 'open'", () => {
    expect(normalizePayrollStatus(null)).toBe("open");
    expect(normalizePayrollStatus("paid")).toBe("paid");
    expect(normalizePayrollStatus("locked")).toBe("locked");
    expect(normalizePayrollStatus("closed")).toBe("locked");
    expect(normalizePayrollStatus("approved")).toBe("locked");
    expect(normalizePayrollStatus("something-else")).toBe("open");
  });

  it("a period is editable only while 'open', and locked otherwise (including 'paid')", () => {
    expect(isPayrollPeriodEditable("open")).toBe(true);
    expect(isPayrollPeriodEditable(null)).toBe(true);
    expect(isPayrollPeriodEditable("locked")).toBe(false);
    expect(isPayrollPeriodLocked("paid")).toBe(true); // a paid period is NOT editable
  });
});

describe("isSessionInPeriod / collectLockedSessionIds", () => {
  const period = { id: "p1", period_month: "2026-05", start_date: "2026-05-01", end_date: "2026-05-31", status: "open" };

  it("includes a session exactly at the period's start/end boundaries", () => {
    expect(isSessionInPeriod({ clock_in: "2026-05-01T00:00:00" }, period)).toBe(true);
    expect(isSessionInPeriod({ clock_in: "2026-05-31T23:59:59" }, period)).toBe(true);
  });

  it("excludes a session outside the period", () => {
    expect(isSessionInPeriod({ clock_in: "2026-06-01T00:00:00" }, period)).toBe(false);
  });

  it("collectLockedSessionIds only flags sessions inside a LOCKED period, never an open one", () => {
    const sessions = [
      { id: "s1", clock_in: "2026-05-15T09:00:00" },
      { id: "s2", clock_in: "2026-06-15T09:00:00" },
    ];
    expect(collectLockedSessionIds(sessions, [{ ...period, status: "open" }]).size).toBe(0);
    const locked = collectLockedSessionIds(sessions, [{ ...period, status: "locked" }]);
    expect(locked.has("s1")).toBe(true);
    expect(locked.has("s2")).toBe(false);
  });
});

describe("getCurrentPayrollPeriod", () => {
  it("returns the exact period_month match when one exists", () => {
    const periods = [
      { id: "a", period_month: "2026-04", start_date: "", end_date: "", status: "locked" },
      { id: "b", period_month: "2026-05", start_date: "", end_date: "", status: "open" },
    ];
    const found = getCurrentPayrollPeriod(periods, new Date("2026-05-15"));
    expect(found?.id).toBe("b");
  });

  it("falls back to the most recent period (by period_month) when there's no exact match", () => {
    const periods = [
      { id: "a", period_month: "2026-02", start_date: "", end_date: "", status: "locked" },
      { id: "b", period_month: "2026-04", start_date: "", end_date: "", status: "locked" },
    ];
    const found = getCurrentPayrollPeriod(periods, new Date("2026-06-01"));
    expect(found?.id).toBe("b");
  });

  it("returns null for an empty period list", () => {
    expect(getCurrentPayrollPeriod([], new Date("2026-05-15"))).toBeNull();
  });
});

describe("getPayslipItemsTotal", () => {
  it("sums only the items belonging to the given payslip, coercing non-numeric amounts to 0", () => {
    const items = [
      { id: "i1", payslip_id: "ps-1", user_id: "u1", item_type: "bonus", amount: 100, notes: null },
      { id: "i2", payslip_id: "ps-1", user_id: "u1", item_type: "bonus", amount: "not-a-number", notes: null },
      { id: "i3", payslip_id: "ps-2", user_id: "u1", item_type: "bonus", amount: 500, notes: null },
    ];
    expect(getPayslipItemsTotal(items, "ps-1")).toBe(100);
  });
});

describe("getLatestHourlyOverride", () => {
  it("returns the most recently created override for the given user, ignoring other users", () => {
    const overrides = [
      { id: "o1", user_id: "u1", start_time: null, end_time: null, override_hourly_rate: 60, reason: null, notes: null, created_at: "2026-01-01T00:00:00", updated_at: null },
      { id: "o2", user_id: "u1", start_time: null, end_time: null, override_hourly_rate: 70, reason: null, notes: null, created_at: "2026-03-01T00:00:00", updated_at: null },
      { id: "o3", user_id: "u2", start_time: null, end_time: null, override_hourly_rate: 999, reason: null, notes: null, created_at: "2026-05-01T00:00:00", updated_at: null },
    ];
    expect(getLatestHourlyOverride(overrides, "u1")?.id).toBe("o2");
  });

  it("returns null when the user has no overrides", () => {
    expect(getLatestHourlyOverride([], "u1")).toBeNull();
  });
});

describe("resolveSessionLaborCost", () => {
  it("an explicit positive labor_cost on the session always wins, ignoring the agreement entirely", () => {
    const cost = resolveSessionLaborCost(
      { labor_cost: 999, worked_minutes: 60, clock_in: "2026-05-01T09:00:00", clock_out: "2026-05-01T10:00:00" },
      hourlyAgreement(),
      null
    );
    expect(cost).toBe(999);
  });

  it("is 0 with no active agreement", () => {
    const cost = resolveSessionLaborCost(
      { labor_cost: null, worked_minutes: 60, clock_in: "2026-05-01T09:00:00", clock_out: "2026-05-01T10:00:00" },
      null,
      null
    );
    expect(cost).toBe(0);
  });

  it("an hourly override rate takes precedence over the agreement's own rate", () => {
    const cost = resolveSessionLaborCost(
      { labor_cost: null, worked_minutes: 120, clock_in: "2026-05-01T09:00:00", clock_out: "2026-05-01T11:00:00" },
      hourlyAgreement({ hourly_rate: 50 }),
      { id: "o1", user_id: "u1", start_time: null, end_time: null, override_hourly_rate: 100, reason: null, notes: null, created_at: null, updated_at: null }
    );
    expect(cost).toBe(200); // 100/hr * 2h
  });

  it("falls through to the standard agreement-based calculation with no override", () => {
    // 8h at 50/hr, standard_daily_hours=8 -> no overtime -> 400.
    const cost = resolveSessionLaborCost(
      { labor_cost: null, worked_minutes: 480, clock_in: "2026-05-01T08:00:00", clock_out: "2026-05-01T16:00:00" },
      hourlyAgreement(),
      null
    );
    expect(cost).toBe(400);
  });
});

describe("calculateSessionLaborCostsByDay", () => {
  it("a session under the standard daily hours is entirely 'regular' rate", () => {
    const sessions = [{ id: "s1", worked_minutes: null, clock_in: "2026-05-01T08:00:00", clock_out: "2026-05-01T12:00:00" }]; // 4h
    const costs = calculateSessionLaborCostsByDay(sessions, [hourlyAgreement()], null);
    expect(costs.get("s1")).toBe(200); // 4h * 50/hr
  });

  it("splits a single session that crosses the standard-hours line into regular + overtime", () => {
    // standard_daily_hours=8 (480min), session is 600min (10h) -> 480 regular + 120 overtime.
    const sessions = [{ id: "s1", worked_minutes: null, clock_in: "2026-05-01T08:00:00", clock_out: "2026-05-01T18:00:00" }];
    const costs = calculateSessionLaborCostsByDay(sessions, [hourlyAgreement({ hourly_rate: 50, overtime_rate: 75 })], null);
    // (50*480 + 75*120) / 60 = (24000 + 9000) / 60 = 550
    expect(costs.get("s1")).toBe(550);
  });

  it("accumulates minutes ACROSS multiple sessions on the same day — the second session absorbs the overtime", () => {
    const sessions = [
      { id: "s1", worked_minutes: null, clock_in: "2026-05-01T06:00:00", clock_out: "2026-05-01T12:00:00" }, // 6h, fully regular
      { id: "s2", worked_minutes: null, clock_in: "2026-05-01T13:00:00", clock_out: "2026-05-01T17:00:00" }, // 4h, but only 2h of standard remain
    ];
    const costs = calculateSessionLaborCostsByDay(sessions, [hourlyAgreement({ hourly_rate: 50, overtime_rate: 75 })], null);
    expect(costs.get("s1")).toBe(300); // 6h * 50
    // s2: 2h regular (50) + 2h overtime (75) = 100 + 150 = 250
    expect(costs.get("s2")).toBe(250);
  });

  it("does NOT split when the override rate applies — it's a flat rate regardless of standard hours", () => {
    const sessions = [{ id: "s1", worked_minutes: null, clock_in: "2026-05-01T08:00:00", clock_out: "2026-05-01T18:00:00" }]; // 10h
    const override = { id: "o1", user_id: "u1", start_time: null, end_time: null, override_hourly_rate: 100, reason: null, notes: null, created_at: null, updated_at: null };
    const costs = calculateSessionLaborCostsByDay(sessions, [hourlyAgreement()], override);
    expect(costs.get("s1")).toBe(1000); // flat 100/hr * 10h, no overtime split
  });

  it("an open session (no clock_out) always costs 0, regardless of any agreement", () => {
    const sessions = [{ id: "s1", worked_minutes: null, clock_in: "2026-05-01T08:00:00", clock_out: null }];
    const costs = calculateSessionLaborCostsByDay(sessions, [hourlyAgreement()], null);
    expect(costs.get("s1")).toBe(0);
  });

  it("leaves a session out of the map entirely (not zeroed) when no agreement covers its date", () => {
    const sessions = [{ id: "s1", worked_minutes: null, clock_in: "2026-05-01T08:00:00", clock_out: "2026-05-01T12:00:00" }];
    const costs = calculateSessionLaborCostsByDay(sessions, [], null); // no agreements at all
    expect(costs.has("s1")).toBe(false);
  });

  it("a monthly (non-hourly) agreement is prorated across the worked minutes, not split into overtime", () => {
    const monthly: SalaryAgreementRow = {
      id: "agr-2",
      user_id: "u1",
      salary_type: "monthly",
      hourly_rate: null,
      monthly_salary: 8000,
      valid_from: "2026-01-01",
      valid_to: null,
      notes: null,
      overtime_rate: null,
      standard_daily_hours: 8,
    } as SalaryAgreementRow;
    const sessions = [{ id: "s1", worked_minutes: null, clock_in: "2026-05-01T08:00:00", clock_out: "2026-05-01T16:00:00" }]; // 480min
    const costs = calculateSessionLaborCostsByDay(sessions, [monthly], null);
    // (8000 * 480) / (8*22*60) = 3840000 / 10560 = 363.636... -> rounds to 363.64
    expect(costs.get("s1")).toBeCloseTo(363.64, 2);
  });
});

describe("buildPeriodBounds", () => {
  it("returns the first/last day of the given month", () => {
    expect(buildPeriodBounds("2026-05")).toEqual({ startDate: "2026-05-01", endDate: "2026-05-31" });
  });

  it("handles February correctly across leap and non-leap years", () => {
    expect(buildPeriodBounds("2026-02")?.endDate).toBe("2026-02-28"); // 2026 is not a leap year
    expect(buildPeriodBounds("2024-02")?.endDate).toBe("2024-02-29"); // 2024 is
  });

  it("rolls December over into the next year correctly", () => {
    expect(buildPeriodBounds("2026-12")).toEqual({ startDate: "2026-12-01", endDate: "2026-12-31" });
  });

  it("returns null for a malformed period key", () => {
    expect(buildPeriodBounds("not-a-period")).toBeNull();
  });
});

describe("inferSessionBusinessDomain", () => {
  it("passes through a recognized domain unchanged", () => {
    expect(inferSessionBusinessDomain("logistics_projects")).toBe("logistics_projects");
  });

  it("falls back to general_business for anything unrecognized, missing or null", () => {
    expect(inferSessionBusinessDomain("not-a-real-domain")).toBe("general_business");
    expect(inferSessionBusinessDomain(null)).toBe("general_business");
    expect(inferSessionBusinessDomain(undefined)).toBe("general_business");
  });
});

// A tiny in-memory Supabase: enough of the query builder for ensureRecentPayslips
// and the generatePayslipsForPeriod it calls (select/insert/update + eq/in/is/gte/lte).
type FakeRow = Record<string, unknown>;
function fakeDb(tables: Record<string, FakeRow[]>) {
  let nextId = 1;
  const from = (table: string) => {
    const rows = (tables[table] ??= []);
    let op: "select" | "insert" | "update" = "select";
    let payload: FakeRow | FakeRow[] | null = null;
    const filters: Array<(row: FakeRow) => boolean> = [];
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.order = () => builder;
    builder.range = () => builder;
    builder.eq = (column: string, value: unknown) => (filters.push((row) => row[column] === value), builder);
    builder.in = (column: string, values: unknown[]) => (filters.push((row) => values.includes(row[column])), builder);
    builder.is = (column: string, value: unknown) => (filters.push((row) => (row[column] ?? null) === value), builder);
    builder.gte = (column: string, value: string) => (filters.push((row) => String(row[column]) >= value), builder);
    builder.lte = (column: string, value: string) => (filters.push((row) => String(row[column]) <= value), builder);
    builder.insert = (values: FakeRow | FakeRow[]) => ((op = "insert"), (payload = values), builder);
    builder.update = (values: FakeRow) => ((op = "update"), (payload = values), builder);
    const run = () => {
      if (op === "insert") {
        const list = Array.isArray(payload) ? payload : [payload as FakeRow];
        if (table === "payroll_periods" && list.some((value) => rows.some((row) => row.period_month === value.period_month))) {
          return { data: null, error: { message: "duplicate key value violates unique constraint" } };
        }
        const inserted = list.map((value) => ({ id: `${table}-${nextId++}`, ...value }));
        rows.push(...inserted);
        return { data: inserted, error: null };
      }
      const matched = rows.filter((row) => filters.every((filter) => filter(row)));
      if (op === "update") matched.forEach((row) => Object.assign(row, payload));
      return { data: matched, error: null };
    };
    builder.maybeSingle = () => {
      const result = run();
      return Promise.resolve({ data: result.data?.[0] ?? null, error: result.error });
    };
    builder.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
      Promise.resolve(run()).then(onFulfilled, onRejected);
    return builder;
  };
  return { from, tables };
}

function monthlyWorker(id: string, overrides: FakeRow = {}): FakeRow {
  return { id, full_name: id, role: "worker", active: true, payroll_worker_type: "monthly_payslip", pay_tracking_mode: "payslip", ...overrides };
}

function monthlyAgreement(userId: string, overrides: FakeRow = {}): FakeRow {
  return {
    id: `agr-${userId}`,
    user_id: userId,
    salary_type: "monthly",
    monthly_salary: 8000,
    hourly_rate: null,
    valid_from: "2026-04-01",
    valid_to: null,
    ...overrides,
  };
}

describe("ensureRecentPayslips", () => {
  // The 9th of September, Israel time: August is the month about to be paid.
  const ON_THE_9TH = new Date("2026-09-09T08:00:00Z");

  it("opens last month's and this month's periods and gives a monthly worker who never clocks in a payslip in each", async () => {
    const db = fakeDb({
      users: [monthlyWorker("m1")],
      salary_agreements: [monthlyAgreement("m1")],
    });

    const result = await ensureRecentPayslips(db, ON_THE_9TH);

    expect(result.createdPeriods).toEqual(["2026-08", "2026-09"]);
    expect(db.tables.payroll_periods.map((period) => period.period_month)).toEqual(["2026-08", "2026-09"]);
    expect(db.tables.payroll_periods[0]).toMatchObject({ start_date: "2026-08-01", end_date: "2026-08-31", status: "open" });
    expect(db.tables.payslips).toHaveLength(2);
    expect(db.tables.payslips.every((payslip) => payslip.user_id === "m1" && payslip.gross_salary === 8000)).toBe(true);
    expect(result.createdPayslips).toBe(2);
  });

  it("only fills in what's missing — an existing period and payslip are left as they are", async () => {
    const db = fakeDb({
      users: [monthlyWorker("m1")],
      salary_agreements: [monthlyAgreement("m1")],
      payroll_periods: [{ id: "aug", period_month: "2026-08", start_date: "2026-08-01", end_date: "2026-08-31", status: "open" }],
      payslips: [{ id: "ps-aug", payroll_period_id: "aug", user_id: "m1", gross_salary: 7500, manual_adjustments: 0 }],
    });

    const result = await ensureRecentPayslips(db, ON_THE_9TH);

    expect(result.createdPeriods).toEqual(["2026-09"]);
    expect(db.tables.payroll_periods).toHaveLength(2);
    expect(db.tables.payslips.filter((payslip) => payslip.payroll_period_id === "aug")).toEqual([
      expect.objectContaining({ id: "ps-aug", gross_salary: 7500 }),
    ]);
    expect(result.createdPayslips).toBe(1);
  });

  it("running twice creates nothing the second time", async () => {
    const db = fakeDb({
      users: [monthlyWorker("m1")],
      salary_agreements: [monthlyAgreement("m1")],
    });

    await ensureRecentPayslips(db, ON_THE_9TH);
    const second = await ensureRecentPayslips(db, ON_THE_9TH);

    expect(second).toEqual({ createdPeriods: [], createdPayslips: 0 });
    expect(db.tables.payslips).toHaveLength(2);
  });

  it("skips a worker with no agreement covering the month, inactive and session-paid workers, and locked periods", async () => {
    const db = fakeDb({
      users: [
        monthlyWorker("starts-in-october"),
        monthlyWorker("left", { active: false }),
        monthlyWorker("per-session", { payroll_worker_type: "session_only", pay_tracking_mode: "session" }),
        monthlyWorker("m1"),
      ],
      salary_agreements: [
        monthlyAgreement("starts-in-october", { valid_from: "2026-10-01" }),
        monthlyAgreement("left"),
        monthlyAgreement("per-session"),
        monthlyAgreement("m1"),
      ],
      payroll_periods: [{ id: "aug", period_month: "2026-08", start_date: "2026-08-01", end_date: "2026-08-31", status: "locked" }],
    });

    await ensureRecentPayslips(db, ON_THE_9TH);

    expect(db.tables.payslips.map((payslip) => payslip.user_id)).toEqual(["m1"]);
    expect(db.tables.payslips[0].payroll_period_id).not.toBe("aug");
  });

  it("does nothing when there are no payslip-tracked workers", async () => {
    const db = fakeDb({ users: [monthlyWorker("per-session", { payroll_worker_type: "session_only", pay_tracking_mode: "session" })] });

    const result = await ensureRecentPayslips(db, ON_THE_9TH);

    expect(result).toEqual({ createdPeriods: [], createdPayslips: 0 });
    expect(db.tables.payroll_periods ?? []).toHaveLength(0);
  });
});

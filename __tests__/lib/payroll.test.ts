import { describe, it, expect } from "vitest";
import { calculateSessionLaborCost } from "@/lib/payroll";
import type { SalaryAgreementRow } from "@/lib/payroll";

function makeHourlyAgreement(overrides: Partial<SalaryAgreementRow> = {}): SalaryAgreementRow {
  return {
    id: "agr-1",
    user_id: "user-1",
    salary_type: "hourly",
    hourly_rate: 50,
    monthly_salary: null,
    overtime_rate: null,
    standard_daily_hours: 8,
    valid_from: "2024-01-01",
    valid_to: null,
    notes: null,
    due_day_of_next_month: 10,
    ...overrides,
  };
}

function makeMonthlyAgreement(overrides: Partial<SalaryAgreementRow> = {}): SalaryAgreementRow {
  return {
    id: "agr-2",
    user_id: "user-1",
    salary_type: "monthly",
    hourly_rate: null,
    monthly_salary: 10560, // 8h × 22 days × 60min = 10560 min/month at ₪1/min
    overtime_rate: null,
    standard_daily_hours: 8,
    valid_from: "2024-01-01",
    valid_to: null,
    notes: null,
    due_day_of_next_month: 10,
    ...overrides,
  };
}

describe("calculateSessionLaborCost — hourly", () => {
  it("computes cost for regular hours (below daily threshold)", () => {
    // 50 ₪/h × 4h = 200 ₪
    expect(calculateSessionLaborCost(makeHourlyAgreement(), 240)).toBe(200);
  });

  it("computes cost for exactly one full day", () => {
    // 50 ₪/h × 8h = 400 ₪
    expect(calculateSessionLaborCost(makeHourlyAgreement(), 480)).toBe(400);
  });

  it("applies same rate for overtime when no overtime_rate set", () => {
    // 480 regular min @ ₪50/h + 60 overtime @ ₪50/h = 400 + 50 = 450
    expect(calculateSessionLaborCost(makeHourlyAgreement(), 540)).toBe(450);
  });

  it("applies overtime_rate for minutes above daily threshold", () => {
    // 480 regular @ ₪50/h + 60 overtime @ ₪75/h
    // = (50 × 480/60) + (75 × 60/60) = 400 + 75 = 475
    expect(calculateSessionLaborCost(makeHourlyAgreement({ overtime_rate: 75 }), 540)).toBe(475);
  });

  it("returns null for zero worked minutes", () => {
    expect(calculateSessionLaborCost(makeHourlyAgreement(), 0)).toBeNull();
  });

  it("returns null for negative worked minutes", () => {
    expect(calculateSessionLaborCost(makeHourlyAgreement(), -10)).toBeNull();
  });

  it("returns null when hourly_rate is 0", () => {
    expect(calculateSessionLaborCost(makeHourlyAgreement({ hourly_rate: 0 }), 240)).toBeNull();
  });

  it("returns null for null agreement", () => {
    expect(calculateSessionLaborCost(null, 240)).toBeNull();
  });
});

describe("calculateSessionLaborCost — monthly (proration)", () => {
  it("prorates monthly salary by session minutes", () => {
    // Monthly salary ₪10,560, estimated 10,560 min/month → ₪1/min
    // 120 minutes → ₪120
    expect(calculateSessionLaborCost(makeMonthlyAgreement(), 120)).toBe(120);
  });

  it("proration uses standard_daily_hours × 22 × 60 as denominator", () => {
    // 4h daily: 4 × 22 × 60 = 5280 min/month
    // salary ₪5280, session 60 min → ₪60
    const agreement = makeMonthlyAgreement({ monthly_salary: 5280, standard_daily_hours: 4 });
    expect(calculateSessionLaborCost(agreement, 60)).toBe(60);
  });

  it("returns null when monthly_salary is 0", () => {
    expect(calculateSessionLaborCost(makeMonthlyAgreement({ monthly_salary: 0 }), 120)).toBeNull();
  });

  it("rounds to 2 decimal places", () => {
    // salary ₪10000, denominator 10560 → ₪10000/10560 per min
    // 100 min → ₪94.696... → rounds to ₪94.70
    const agreement = makeMonthlyAgreement({ monthly_salary: 10000 });
    const result = calculateSessionLaborCost(agreement, 100);
    expect(result).toBe(Math.round((10000 * 100) / 10560 * 100) / 100);
  });
});

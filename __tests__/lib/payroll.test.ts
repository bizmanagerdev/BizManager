import { describe, it, expect } from "vitest";
import { calculateSessionLaborCost, computeSessionPaymentStatus, getNextMonthDueText, getPayableDebtAmount, israelDateKey } from "@/lib/payroll";
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
    business_domain: "general_business",
    project_id: null,
    property_id: null,
    is_billable_to_customer: null,
    bill_to_customer_amount: null,
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
    business_domain: "general_business",
    project_id: null,
    property_id: null,
    is_billable_to_customer: null,
    bill_to_customer_amount: null,
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

// Mirrors the CASE in worker_debt_items_view.payment_status
// (db/sql/create_worker_payment_views.sql) exactly — same thresholds, same
// precedence — so a session read straight off attendance_sessions never
// disagrees with what that view would say for a session it actually carries.
describe("computeSessionPaymentStatus", () => {
  it("is paid when paid equals earned (within the 1-cent tolerance)", () => {
    expect(computeSessionPaymentStatus(240, 240)).toBe("paid");
    expect(computeSessionPaymentStatus(240, 240.005)).toBe("paid");
  });

  it("is unpaid when nothing has been paid", () => {
    expect(computeSessionPaymentStatus(150, 0)).toBe("unpaid");
  });

  it("is partial when something, but not enough, has been paid", () => {
    expect(computeSessionPaymentStatus(150, 60)).toBe("partial");
  });

  it("is overpaid when more than earned has been paid", () => {
    expect(computeSessionPaymentStatus(100, 150)).toBe("overpaid");
  });

  it("prefers 'paid' over 'overpaid' inside the rounding tolerance", () => {
    expect(computeSessionPaymentStatus(100, 100.009)).toBe("paid");
  });
});

describe("israelDateKey", () => {
  it("uses the Israeli calendar day, not UTC", () => {
    // 22:30 UTC on Aug 31 is already Sep 1 in Israel (UTC+3 in summer).
    expect(israelDateKey(new Date("2026-08-31T22:30:00Z"))).toBe("2026-09-01");
    expect(israelDateKey(new Date("2026-08-31T12:00:00Z"))).toBe("2026-08-31");
  });
});

describe("getPayableDebtAmount", () => {
  const augustPayslip = {
    source_type: "payslip",
    payment_status: "not_due",
    source_date: "2026-08-31",
    earned_amount: 8000,
    paid_amount: 0,
    owed_amount: 0,
  };

  it("an owed item is payable up to what it owes", () => {
    expect(getPayableDebtAmount({ ...augustPayslip, payment_status: "unpaid", owed_amount: 8000 }, "2026-09-12")).toBe(8000);
    expect(getPayableDebtAmount({ ...augustPayslip, source_type: "session", payment_status: "partial", owed_amount: 250 }, "2026-09-12")).toBe(250);
  });

  it("a finished month's payslip is payable before its pay day (the 9th for a salary due on the 10th)", () => {
    expect(getPayableDebtAmount(augustPayslip, "2026-09-09")).toBe(8000);
    expect(getPayableDebtAmount(augustPayslip, "2026-09-01")).toBe(8000);
  });

  it("only the unpaid remainder of an early, partly paid payslip is payable", () => {
    expect(getPayableDebtAmount({ ...augustPayslip, paid_amount: 3000 }, "2026-09-09")).toBe(5000);
  });

  it("the month still running is not payable yet — money given mid-month stays an advance", () => {
    expect(getPayableDebtAmount({ ...augustPayslip, source_date: "2026-09-30" }, "2026-09-18")).toBe(0);
    expect(getPayableDebtAmount({ ...augustPayslip, source_date: "2026-08-31" }, "2026-08-31")).toBe(0);
  });

  it("a paid payslip has nothing left to pay", () => {
    expect(getPayableDebtAmount({ ...augustPayslip, payment_status: "paid", paid_amount: 8000 }, "2026-09-09")).toBe(0);
  });
});

describe("getNextMonthDueText", () => {
  it("salary for a month is due on the 10th of the next one", () => {
    expect(getNextMonthDueText("2026-08-31")).toBe("10/09/26");
  });

  it("December rolls into January of the next year", () => {
    expect(getNextMonthDueText("2026-12-31")).toBe("10/01/27");
  });

  it("reads the month off the DATE, not off a device's clock", () => {
    // The period end used to be turned into an instant and then asked for its
    // month locally — west of UTC, 1 January came back as the previous December
    // and the salary showed as due a month early.
    const originalTz = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      expect(getNextMonthDueText("2026-01-01")).toBe("10/02/26");
      expect(getNextMonthDueText("2026-01-31")).toBe("10/02/26");
    } finally {
      process.env.TZ = originalTz;
    }
  });

  it("falls back to '-' for missing or unparseable input", () => {
    expect(getNextMonthDueText(null)).toBe("-");
    expect(getNextMonthDueText("")).toBe("-");
    expect(getNextMonthDueText("not a date")).toBe("-");
  });
});

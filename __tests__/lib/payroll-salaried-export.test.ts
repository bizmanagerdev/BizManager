import { describe, it, expect } from "vitest";
import { buildSalariedHoursWorkbook } from "@/lib/payroll-salaried-export";
import type { SalaryAgreementRow } from "@/lib/payroll";
import type { WorkerAbsenceRow } from "@/lib/payroll-bonuses";

/**
 * The two rules the hours sheet has to get right for a global worker:
 *  • a day the business was closed (chag / erev chag / chol hamoed) doesn't
 *    appear at all — nobody was expected to work it;
 *  • a day HE was off appears, with the date and the reason, and no hours —
 *    the whole point being that the sheet shows it as his and empty.
 */

const AGREEMENT: SalaryAgreementRow = {
  id: "agr-1",
  user_id: "user-1",
  salary_type: "monthly",
  hourly_rate: null,
  monthly_salary: 12000,
  overtime_rate: null,
  standard_daily_hours: 9,
  valid_from: "2020-01-01",
  valid_to: null,
  notes: null,
  due_day_of_next_month: 10,
  business_domain: "general_business",
  project_id: null,
  property_id: null,
  is_billable_to_customer: null,
  bill_to_customer_amount: null,
};

const USER = {
  id: "user-1",
  full_name: "ישראל ישראלי",
  email: "worker@example.com",
  role: "worker",
  active: true,
};

function absence(date: string, overrides: Partial<WorkerAbsenceRow> = {}): WorkerAbsenceRow {
  return {
    id: `abs-${date}`,
    user_id: "user-1",
    absence_date: date,
    absence_type: "day_off",
    paid: true,
    notes: null,
    created_by: null,
    created_at: null,
    ...overrides,
  };
}

/** The `<Row>` blocks of the worker's own sheet (the second worksheet). */
function workerRows(xml: string) {
  const sheets = xml.split("<Worksheet ");
  const workerSheet = sheets[2] ?? "";
  return workerSheet.split("<Row").slice(1);
}

describe("buildSalariedHoursWorkbook", () => {
  it("prints a normal Sun–Thu workday with planned hours", () => {
    // September 2026: the 8th is a Tuesday with no holiday near it.
    const xml = buildSalariedHoursWorkbook("2026-09", [USER], [AGREEMENT], [], []);
    expect(xml).toContain("2026-09-08");
    const rowWithDate = workerRows(xml).find((row) => row.includes("2026-09-08")) ?? "";
    expect(rowWithDate).toContain("09:00");
    expect(rowWithDate).toContain("18:00");
  });

  it("drops chag and erev chag entirely and lists them as excluded", () => {
    const xml = buildSalariedHoursWorkbook("2026-09", [USER], [AGREEMENT], [], []);
    const rows = workerRows(xml);
    // A daily row has the date as the WHOLE cell; the excluded-holidays line has
    // it inside a longer sentence, so this can't confuse the two.
    const hasDayRow = (date: string) => rows.some((row) => row.includes(`>${date}</Data>`));

    // No daily row for any of these Sun–Thu days:
    expect(hasDayRow("2026-09-13")).toBe(false); // ראש השנה ב׳ (Sunday)
    expect(hasDayRow("2026-09-20")).toBe(false); // ערב יום כיפור (Sunday)
    expect(hasDayRow("2026-09-21")).toBe(false); // יום כיפור (Monday)

    // …but they're named in the sheet's "excluded holidays" line, so it's clear
    // WHY the month is short rather than looking like missing data.
    expect(xml).toContain("חגים שהוחרגו");
    expect(xml).toContain("2026-09-21 - יום כיפור");
  });

  it("keeps the middle of chol hamoed as ordinary workdays", () => {
    const xml = buildSalariedHoursWorkbook("2026-09", [USER], [AGREEMENT], [], []);
    const rows = workerRows(xml);
    const dayRow = (date: string) => rows.find((row) => row.includes(`>${date}</Data>`)) ?? "";

    // סוכות ג׳–ה׳ (חוה״מ), Mon–Wed — worked, full planned hours.
    expect(dayRow("2026-09-28")).toContain("09:00");
    expect(dayRow("2026-09-29")).toContain("09:00");
    expect(dayRow("2026-09-30")).toContain("09:00");
  });

  it("keeps a day-off row but empties its hours", () => {
    const xml = buildSalariedHoursWorkbook("2026-09", [USER], [AGREEMENT], [], [absence("2026-09-08")]);

    const dayRow = workerRows(xml).find((row) => row.includes("2026-09-08")) ?? "";
    expect(dayRow).toBeTruthy();
    // The date still prints; the times and hours do not.
    expect(dayRow).not.toContain("09:00");
    expect(dayRow).not.toContain("18:00");
    expect(dayRow).toContain("יום חופש");
  });

  it("excludes days off from the planned-hours total and counts them separately", () => {
    const withoutAbsence = buildSalariedHoursWorkbook("2026-09", [USER], [AGREEMENT], [], []);
    const withAbsence = buildSalariedHoursWorkbook(
      "2026-09",
      [USER],
      [AGREEMENT],
      [],
      [absence("2026-09-08"), absence("2026-09-09")]
    );

    const totalOf = (xml: string) => {
      // The summary sheet's planned-hours cell for this worker.
      const match = /<Data ss:Type="Number">(\d+(?:\.\d+)?)<\/Data>/g;
      return [...xml.matchAll(match)].map((m) => Number(m[1]));
    };

    // Two nine-hour days come off the planned total.
    const before = Math.max(...totalOf(withoutAbsence));
    const after = Math.max(...totalOf(withAbsence));
    expect(before - after).toBe(18);
    expect(withAbsence).toContain("ימי היעדרות");
  });

  it("shows the absence note next to the reason", () => {
    const xml = buildSalariedHoursWorkbook(
      "2026-09",
      [USER],
      [AGREEMENT],
      [],
      [absence("2026-09-08", { absence_type: "sick", notes: "מחלה" })]
    );
    const dayRow = workerRows(xml).find((row) => row.includes("2026-09-08")) ?? "";
    expect(dayRow).toContain("מחלה");
  });
});

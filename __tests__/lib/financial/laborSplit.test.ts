import { describe, expect, it } from "vitest";
import { buildEarnedLaborItems, buildPayslipDomainShares, splitPayslipByShifts } from "@/lib/financial/laborSplit";

// Owner, 2026-10-13: pay goes where it was worked. An hourly payslip is split by
// its shifts; a monthly ("global") payslip stays whole on its agreement.

const sum = (parts: { amount: number }[]) => parts.reduce((s, p) => s + p.amount, 0);

describe("splitPayslipByShifts", () => {
  it("sends each shift's cost to its area/project and the rest to the agreement", () => {
    const parts = splitPayslipByShifts({ amount: 5000, domain: "general_business", projectId: null }, [
      { domain: "logistics_projects", projectId: "p1", cost: 2000, date: "2026-09-03" },
      { domain: "logistics_projects", projectId: "p1", cost: 1000, date: "2026-09-10" },
      { domain: "general_business", projectId: null, cost: 1500, date: "2026-09-04" },
      { domain: "sales", projectId: null, cost: 300, date: "2026-09-05" },
    ]);
    const find = (domain: string, projectId: string | null, date: string | null) =>
      parts.find((p) => p.domain === domain && p.projectId === projectId && p.date === date);
    expect(find("logistics_projects", "p1", "2026-09-10")?.amount).toBe(3000);
    expect(find("general_business", null, "2026-09-04")?.amount).toBe(1500);
    expect(find("sales", null, "2026-09-05")?.amount).toBe(300);
    // ₪200 the payslip adds on top (a bonus) stays with the agreement's area.
    expect(find("general_business", null, null)?.amount).toBe(200);
    expect(sum(parts)).toBe(5000);
  });

  it("keeps a payslip with no shifts whole on its agreement (a monthly worker)", () => {
    expect(splitPayslipByShifts({ amount: 8000, domain: "logistics_projects", projectId: "tovel" }, [])).toEqual([
      { domain: "logistics_projects", projectId: "tovel", amount: 8000, date: null },
    ]);
  });

  it("scales the shifts down when they come to more than the payslip", () => {
    const parts = splitPayslipByShifts({ amount: 900, domain: "general_business", projectId: null }, [
      { domain: "logistics_projects", projectId: "p1", cost: 600, date: "2026-09-03" },
      { domain: "sales", projectId: null, cost: 400, date: "2026-09-04" },
    ]);
    expect(parts.find((p) => p.domain === "logistics_projects")?.amount).toBeCloseTo(540);
    expect(parts.find((p) => p.domain === "sales")?.amount).toBeCloseTo(360);
    expect(parts).toHaveLength(2);
    expect(sum(parts)).toBeCloseTo(900);
  });

  it("gives a shift with no area the payslip's area", () => {
    const parts = splitPayslipByShifts({ amount: 100, domain: "general_business", projectId: null }, [
      { domain: null, projectId: null, cost: 100, date: "2026-09-03" },
    ]);
    expect(parts).toEqual([{ domain: "general_business", projectId: null, amount: 100, date: "2026-09-03" }]);
  });
});

describe("buildEarnedLaborItems", () => {
  const debtRows = [
    // contract worker's shift — unchanged
    { source_type: "session", user_id: "c1", project_id: "p2", business_domain: "logistics_projects", period_month: "2026-09", source_date: "2026-09-08", earned_amount: 400 },
    // hourly payslip worker — split by September's shifts
    { source_type: "payslip", user_id: "h1", project_id: null, business_domain: "general_business", period_month: "2026-09", source_date: "2026-09-01", earned_amount: "1000" },
    // monthly worker tied to a project — whole
    { source_type: "payslip", user_id: "m1", project_id: "tovel", business_domain: "logistics_projects", period_month: "2026-09", source_date: "2026-09-01", earned_amount: 8000 },
  ];
  const shifts = [
    { user_id: "h1", clock_in: "2026-09-02T05:00:00+00:00", labor_cost: 700, business_domain: "logistics_projects", project_id: "p1" },
    { user_id: "h1", clock_in: "2026-09-03T05:00:00+00:00", labor_cost: 250, business_domain: "sales", project_id: null },
    // hours for בית move to בית (shown when "כולל בית וצדקה" is ticked)
    { user_id: "h1", clock_in: "2026-09-04T05:00:00+00:00", labor_cost: 30, business_domain: "home", project_id: null },
    // August shift: belongs to August's payslip, not September's
    { user_id: "h1", clock_in: "2026-08-31T05:00:00+00:00", labor_cost: 999, business_domain: "home", project_id: null },
  ];

  it("splits the hourly payslip, keeps the rest as they are, and keeps every shekel", () => {
    const items = buildEarnedLaborItems(debtRows, shifts);
    const h1 = items.filter((i) => i.userId === "h1");
    expect(h1.find((i) => i.projectId === "p1")).toMatchObject({ domain: "logistics_projects", amount: 700, month: "2026-09", date: "2026-09-02" });
    expect(h1.find((i) => i.domain === "sales")).toMatchObject({ amount: 250 });
    expect(h1.find((i) => i.domain === "home")).toMatchObject({ amount: 30, date: "2026-09-04" });
    expect(h1.find((i) => i.domain === "general_business")).toMatchObject({ amount: 20, date: "2026-09-01" });
    expect(h1.some((i) => i.amount === 999)).toBe(false);
    expect(sum(h1)).toBe(1000);

    expect(items.find((i) => i.userId === "c1")).toMatchObject({ projectId: "p2", domain: "logistics_projects", amount: 400 });
    expect(items.filter((i) => i.userId === "m1")).toEqual([
      { userId: "m1", projectId: "tovel", domain: "logistics_projects", month: "2026-09", date: "2026-09-01", amount: 8000 },
    ]);
    expect(sum(items)).toBe(9400);
  });
});

describe("buildPayslipDomainShares — the cash reports divide a payslip the same way", () => {
  it("gives an hourly payslip its area shares, adding up to 1", () => {
    const shares = buildPayslipDomainShares(
      [{ source_type: "payslip", source_id: "ps1", user_id: "h1", period_month: "2026-09", business_domain: "general_business", earned_amount: 1000 }],
      [
        { user_id: "h1", clock_in: "2026-09-02T05:00:00+00:00", labor_cost: 600, business_domain: "logistics_projects", project_id: "p1" },
        { user_id: "h1", clock_in: "2026-09-03T05:00:00+00:00", labor_cost: 100, business_domain: "logistics_projects", project_id: "p2" },
        { user_id: "h1", clock_in: "2026-09-04T05:00:00+00:00", labor_cost: 200, business_domain: "home", project_id: null },
      ]
    );
    const parts = shares.get("ps1") ?? [];
    expect(Object.fromEntries(parts.map((p) => [p.domain, p.share]))).toEqual({
      logistics_projects: 0.7,
      home: 0.2,
      general_business: 0.1,
    });
  });

  it("leaves out payslips worked only in their own area (a monthly worker, or no shifts)", () => {
    const shares = buildPayslipDomainShares(
      [
        { source_type: "payslip", source_id: "m1", user_id: "m", period_month: "2026-09", business_domain: "logistics_projects", project_id: "tovel", earned_amount: 8000 },
        { source_type: "payslip", source_id: "g1", user_id: "g", period_month: "2026-09", business_domain: "general_business", earned_amount: 500 },
        { source_type: "session", source_id: "s1", user_id: "c", period_month: "2026-09", business_domain: "sales", earned_amount: 300 },
      ],
      [{ user_id: "g", clock_in: "2026-09-02T05:00:00+00:00", labor_cost: 500, business_domain: "general_business", project_id: null }]
    );
    expect(shares.size).toBe(0);
  });
});

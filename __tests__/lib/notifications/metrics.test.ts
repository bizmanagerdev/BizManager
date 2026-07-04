import { describe, it, expect } from "vitest";
import { alertNoiseVerdict, readRate, type AlertRuleMetric } from "@/lib/notifications/metrics";

function metric(over: Partial<AlertRuleMetric>): AlertRuleMetric {
  return {
    rule_key: "x",
    fired: 20,
    pushable: 20,
    still_open: 0,
    resolved: 20,
    snoozed: 0,
    pushed: 20,
    resolved_unpushed: 0,
    avg_resolve_hours: 3,
    ...over,
  };
}

describe("alertNoiseVerdict", () => {
  it("is 'ok' with too little data to judge", () => {
    expect(alertNoiseVerdict(metric({ fired: 4, pushable: 4, resolved_unpushed: 4, snoozed: 4 })).level).toBe("ok");
  });
  it("never flags a worklist-only rule (0 pushable) as noise", () => {
    // e.g. collection_overdue is silent → high self-resolve is expected, not noise.
    expect(alertNoiseVerdict(metric({ fired: 40, pushable: 0, resolved_unpushed: 0, snoozed: 30 })).level).toBe("ok");
  });
  it("flags 'watch' on a single signal", () => {
    const v = alertNoiseVerdict(metric({ fired: 20, snoozed: 12, resolved_unpushed: 0 }));
    expect(v.level).toBe("watch");
    expect(v.reasons).toHaveLength(1);
  });
  it("flags 'noisy' when both signals trip", () => {
    const v = alertNoiseVerdict(metric({ fired: 20, snoozed: 12, resolved_unpushed: 15 }));
    expect(v.level).toBe("noisy");
    expect(v.reasons).toHaveLength(2);
  });
  it("is 'ok' for a healthy, acted-on rule", () => {
    expect(alertNoiseVerdict(metric({ fired: 30, snoozed: 2, resolved_unpushed: 1 })).level).toBe("ok");
  });
});

describe("readRate", () => {
  it("computes the fraction and guards divide-by-zero", () => {
    expect(readRate({ category: "money", delivered: 10, read_count: 7 })).toBeCloseTo(0.7);
    expect(readRate({ category: "money", delivered: 0, read_count: 0 })).toBe(0);
  });
});

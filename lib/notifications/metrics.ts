// Alert-volume metrics shapes + the pure noise-verdict heuristic. Metrics come
// from the get_alert_rule_metrics / get_alert_read_metrics RPCs; the verdict
// turns raw counts into a "is this rule earning its interruptions?" call so the
// admin can prune noise with data.

export type AlertRuleMetric = {
  rule_key: string;
  fired: number;
  /** Fires eligible to push (not info, not silent). 0 = worklist-only by design. */
  pushable: number;
  still_open: number;
  resolved: number;
  snoozed: number;
  pushed: number;
  resolved_unpushed: number;
  avg_resolve_hours: number | null;
};

export type AlertReadMetric = {
  category: string;
  delivered: number;
  read_count: number;
};

export type NoiseVerdict = { level: "noisy" | "watch" | "ok"; reasons: string[] };

// Two independent noise signals, each a rate of the PUSHABLE volume:
//   * self-resolve  — resolved before it ever pushed → the problem clears faster
//                     than anyone acts, so the ping was pure interruption.
//   * snooze        — pushed off rather than handled → wrong timing / low value.
// One signal = watch, both = noisy. A rule that never pushes (worklist-only by
// design) can't be noisy — no interruptions to judge. Under 5 pushable fires
// there's too little to judge.
export function alertNoiseVerdict(m: AlertRuleMetric): NoiseVerdict {
  if (m.pushable < 5) return { level: "ok", reasons: [] };
  const reasons: string[] = [];
  if (m.resolved_unpushed / m.pushable >= 0.6) reasons.push("נפתרות מעצמן לפני טיפול");
  if (m.snoozed / m.pushable >= 0.5) reasons.push("נדחות ברוב המקרים");
  const level = reasons.length >= 2 ? "noisy" : reasons.length === 1 ? "watch" : "ok";
  return { level, reasons };
}

/** read_count / delivered as a 0–1 fraction (0 when nothing delivered). */
export function readRate(m: AlertReadMetric): number {
  return m.delivered > 0 ? m.read_count / m.delivered : 0;
}

export type AlertSchedule =
  | "daily"
  | "weekdays"
  | "sun"
  | "mon"
  | "tue"
  | "wed"
  | "thu"
  | "fri"
  | "sat";

// mode: 'scheduled' = timed digest push · 'live' = event-driven worklist rule ·
// 'night' = windowed reminder (nightly review). Unified alert registry.
export type AlertMode = "scheduled" | "live" | "night";

export type AlertRow = {
  id: string;
  title: string;
  body: string;
  url: string;
  alert_type: string | null;
  enabled: boolean;
  send_hour_israel: number;
  schedule: AlertSchedule;
  recipient_user_ids: string[];
  sort_order: number;
  created_at: string;
  // Unification columns (may be absent before the migration runs).
  mode?: AlertMode | null;
  rule_key?: string | null;
  audience_role?: string | null; // all | office | admin (live/night)
  send_hour_end_israel?: number | null; // window end (night)
};

export const BUILTIN_ALERT_TYPES = [
  "overdue_tasks",
  "today_tasks",
  "tomorrow_tasks",
  "projects_starting",
  "projects_deadline",
  "deliveries",
  "weekly_summary",
] as const;

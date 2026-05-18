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

// Shared shapes for ישיבה שבועית. Kept in their own leaf module so the server
// loaders, the client components and the stats query can all import them
// without dragging a Supabase client into the browser bundle.

export type MeetingItemKind = "prep" | "agenda";

/** The only auto-filled item today: agenda 0, "התחייבויות משבוע שעבר". */
export const AUTO_SOURCE_PREVIOUS_TASKS = "previous_tasks";

export type MeetingTemplate = {
  id: string;
  kind: MeetingItemKind;
  position: number;
  title: string;
  subpoints: string[];
  linkHref: string | null;
  linkLabel: string | null;
  defaultAssigneeId: string | null;
  autoSource: string | null;
  isActive: boolean;
};

export type MeetingItem = {
  id: string;
  meetingId: string;
  templateId: string | null;
  kind: MeetingItemKind;
  position: number;
  title: string;
  subpoints: string[];
  linkHref: string | null;
  linkLabel: string | null;
  autoSource: string | null;
  isDone: boolean;
  doneBy: string | null;
  doneByName: string | null;
  doneAt: string | null;
  assignedUserId: string | null;
  notes: string | null;
  /** Set when the item arrived unchecked from an earlier meeting. */
  carriedOverFrom: string | null;
  /** That earlier meeting's date, for the "הועבר מ-" badge. */
  carriedOverFromDate: string | null;
};

export type MeetingStatus = "open" | "closed";

export type Meeting = {
  id: string;
  meetingDate: string;
  status: MeetingStatus;
  notes: string | null;
  stats: WeekStats | null;
  collectionTarget: number | null;
  nextMeetingDate: string | null;
  closedAt: string | null;
};

/** A task raised at a meeting, with its status as it stands NOW. */
export type MeetingTask = {
  taskId: string;
  meetingItemId: string | null;
  /** The agenda item it was raised under — "סעיף 3 · גבייה". */
  itemTitle: string | null;
  subject: string;
  status: string;
  assignedUserId: string | null;
  assigneeName: string | null;
  dueDate: string | null;
};

// ── The week's numbers ──────────────────────────────────────────────────────

/** One figure in the header strip. `previous` drives the ▲▼ delta. */
export type WeekMetric = {
  key: string;
  label: string;
  value: number;
  previous: number | null;
  /** 'count' renders bare, 'currency' renders as ₪. */
  format: "count" | "currency";
  /** True when a rise is the bad direction (overdue tasks), so ▲ is not green. */
  invertTrend?: boolean;
  /** Second line under the value, e.g. the collection target. */
  caption?: string;
  /** Third line — a caveat about the caption, such as a target set for a week
   *  being compared against a longer period. */
  captionNote?: string;
  href?: string;
};

export type WeekStats = {
  /** Inclusive ISO date bounds of the period the numbers cover. */
  from: string;
  to: string;
  /**
   * Length of that period in days. Usually 7, but the period runs from the
   * previous meeting to this one — so a skipped fortnight makes it 21, and the
   * strip labels itself accordingly rather than calling it "השבוע".
   */
  days: number;
  metrics: WeekMetric[];
};

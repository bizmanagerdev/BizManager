// The per-user notification preference model — one place that defines the shape,
// the defaults, and how to coerce whatever is in the DB into it.
//
// Stored in users.notification_prefs (jsonb). The set_my_notification_prefs RPC
// writes the object wholesale, so adding keys needs no migration — but every
// reader MUST go through sanitizeNotificationPrefs so old rows (which only have
// { muted, push_paused }) still resolve to sane defaults.

import { NOTIF_BUCKETS } from "@/lib/notifications/categories";

/** How much automatic noise reaches the phone. "שלי" timed reminders ignore this. */
export type DeliveryMode = "summary" | "summary_urgent" | "all";

export type NotificationPrefs = {
  /** summary = one digest a day; summary_urgent = digest + danger; all = every item. */
  delivery: DeliveryMode;
  /** Hour (0–23, Israel time) to receive the daily summary. */
  summary_hour: number;
  /**
   * Buckets you want PUSHED even though they aren't yours. Empty = only your own
   * things interrupt you. This never affects what you can SEE — everything you're
   * permitted to view is always in the inbox.
   */
  subscribe: string[];
  /** Buckets muted entirely (no push, no inbox). */
  muted: string[];
  /** Keep in-app, drop the phone push. */
  push_paused: boolean;
};

export const DEFAULT_PREFS: NotificationPrefs = {
  delivery: "summary",
  summary_hour: 8,
  subscribe: [],
  muted: [],
  push_paused: false,
};

export const DELIVERY_MODES: Array<{ key: DeliveryMode; label: string; hint: string }> = [
  { key: "summary", label: "סיכום יומי בלבד", hint: "התראה אחת בבוקר. כל השאר מחכה בתיבה." },
  { key: "summary_urgent", label: "סיכום + דחוף", hint: "הסיכום היומי, ובנוסף התראה מיידית רק לדברים דחופים." },
  { key: "all", label: "הכול מיד", hint: "כל התראה מגיעה לנייד מיד." },
];

const DELIVERY_KEYS = new Set<string>(DELIVERY_MODES.map((m) => m.key));
const BUCKET_KEYS = new Set(NOTIF_BUCKETS.map((b) => b.key));

/**
 * Buckets you can ask to be PUSHED about even though they aren't yours — the
 * role-broadcast findings that are nobody's personal item (stock, collections,
 * vehicles…). Anything genuinely *yours* always pushes and isn't listed here.
 *
 * These do NOT gate visibility: unsubscribed buckets still appear in your inbox,
 * they just don't ring your phone.
 */
export const SUBSCRIBABLE_BUCKETS: Array<{ key: string; label: string }> = [
  { key: "money", label: "גבייה ותשלומים" },
  { key: "projects", label: "פרויקטים (של אחרים)" },
  { key: "ops", label: "מלאי ותפעול" },
  { key: "payroll", label: "שכר עובדים" },
  { key: "updates", label: "הזמנות/פרויקטים חדשים" },
];

function strArray(value: unknown, allowed: Set<string>): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((v): v is string => typeof v === "string" && allowed.has(v)))];
}

/** Coerce arbitrary JSON (DB row / request body) into a complete NotificationPrefs. */
export function sanitizeNotificationPrefs(value: unknown): NotificationPrefs {
  if (!value || typeof value !== "object") return { ...DEFAULT_PREFS };
  const raw = value as Partial<Record<keyof NotificationPrefs, unknown>>;

  const delivery =
    typeof raw.delivery === "string" && DELIVERY_KEYS.has(raw.delivery)
      ? (raw.delivery as DeliveryMode)
      : DEFAULT_PREFS.delivery;

  let summaryHour = DEFAULT_PREFS.summary_hour;
  const rawHour = typeof raw.summary_hour === "string" ? Number(raw.summary_hour) : raw.summary_hour;
  if (typeof rawHour === "number" && Number.isFinite(rawHour)) {
    const h = Math.trunc(rawHour);
    if (h >= 0 && h <= 23) summaryHour = h;
  }

  return {
    delivery,
    summary_hour: summaryHour,
    subscribe: strArray(raw.subscribe, new Set(SUBSCRIBABLE_BUCKETS.map((b) => b.key))),
    muted: strArray(raw.muted, BUCKET_KEYS),
    push_paused: raw.push_paused === true,
  };
}

/**
 * Does an AUTOMATIC (system) item reach this user's inbox at all?
 * Owner-routed items (assigned to them) bypass this entirely — see §7.2 of the
 * redesign spec: default is "only my own stuff", role buckets are opt-in.
 */
export function isSubscribedTo(prefs: NotificationPrefs, bucket: string): boolean {
  return prefs.subscribe.includes(bucket);
}

/** Should this automatic item interrupt the phone right now (vs wait for the digest)? */
export function shouldPushNow(prefs: NotificationPrefs, severity: string): boolean {
  if (prefs.push_paused) return false;
  if (prefs.delivery === "all") return true;
  if (prefs.delivery === "summary_urgent") return severity === "danger";
  return false; // 'summary' → nothing automatic interrupts; it rolls into the digest
}

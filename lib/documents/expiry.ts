import { daysHe } from "@/lib/i18n/pluralHe";
import { israelDateKey } from "@/lib/timezone";

// ────────────────────────────────────────────────────────────────────────────
// Is this document still good?
//
// A category decides whether the question applies at all (`tracks_expiry`) and
// how much warning it wants (`expiry_lead_days`). The answer is computed against
// the ISRAELI day, not the browser's: a phone on London time would otherwise
// call a licence expired an hour early, or still valid an hour late.
//
// "Superseded" is the part that keeps this quiet. Uploading this year's
// insurance does not make last year's a problem to be solved — the old paper is
// still in the archive, it is simply no longer the one that counts.
// ────────────────────────────────────────────────────────────────────────────

export type ExpiryStatus =
  /** The date has passed. */
  | "expired"
  /** The date is today. */
  | "today"
  /** Inside the category's warning window. */
  | "soon"
  /** Has a date, comfortably ahead — or the category does not expire at all. */
  | "valid"
  /** A newer document of the same kind, for the same thing, has taken over. */
  | "superseded"
  /** The category expires but nobody has said when. */
  | "missing";

export type ExpiryResult = {
  status: ExpiryStatus;
  /** Whole days from today; negative once past. Null when there is no date. */
  daysLeft: number | null;
};

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})/;

function toUtcDay(iso: string | null | undefined): number | null {
  const match = ISO_DAY.exec((iso ?? "").trim());
  if (!match) return null;
  const value = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(value) ? null : value;
}

/** Whole days from one calendar day to another. Null if either is unparseable. */
export function daysBetweenIsoDates(fromIso: string, toIso: string): number | null {
  const from = toUtcDay(fromIso);
  const to = toUtcDay(toIso);
  if (from === null || to === null) return null;
  return Math.round((to - from) / 86_400_000);
}

/**
 * Call this only for a category whose `tracks_expiry` is on — for anything else
 * the question does not apply, and "missing" would be a complaint about a date
 * that was never wanted.
 *
 * `todayIso` defaults to the Israeli day. A browser on London time would
 * otherwise call a licence expired an hour early.
 */
export function getExpiryStatus(
  validUntil: string | null,
  leadDays: number,
  superseded = false,
  todayIso: string = israelDateKey()
): ExpiryResult {
  if (superseded) return { status: "superseded", daysLeft: null };
  if (!validUntil) return { status: "missing", daysLeft: null };

  const days = daysBetweenIsoDates(todayIso, validUntil);
  // An unparseable date is not an expiry claim, so it counts as none.
  if (days === null) return { status: "missing", daysLeft: null };

  if (days < 0) return { status: "expired", daysLeft: days };
  if (days === 0) return { status: "today", daysLeft: 0 };
  if (days <= leadDays) return { status: "soon", daysLeft: days };
  return { status: "valid", daysLeft: days };
}

/** What to call it. Null where the status is not worth saying out loud. */
export function expiryLabel(result: ExpiryResult): string | null {
  switch (result.status) {
    case "expired":
      return "פג תוקף";
    case "today":
      return "פג היום";
    case "soon":
      return `עוד ${daysHe(result.daysLeft ?? 0)}`;
    case "superseded":
      return "הוחלף";
    case "missing":
      return "חסר תאריך תוקף";
    default:
      return null;
  }
}

/** The badge to wear, or null for the statuses that get none. */
export function expiryBadgeTone(status: ExpiryStatus): "destructive" | "warning" | null {
  if (status === "expired" || status === "today") return "destructive";
  if (status === "soon") return "warning";
  return null;
}

/** Statuses that mean a person still has something to do. */
export function isExpiryActionable(status: ExpiryStatus): boolean {
  return status === "expired" || status === "today" || status === "soon";
}

// ── supersession ────────────────────────────────────────────────────────────

export type SupersedableDocument = {
  id: string;
  /** The category code. */
  category: string | null;
  validUntil: string | null;
  /**
   * What the document is FOR — a vehicle, a property, a customer. Empty when
   * nothing is attached, which is why an unfiled document never supersedes
   * another: two loose insurance papers are not known to concern the same car.
   */
  entityKey: string;
};

/**
 * The documents that a newer one has taken over from: same thing, same
 * category, an earlier date than the latest in that group.
 *
 * A document with no date is never superseded — it has made no claim to be out
 * of, and it still needs a date, which is what "חסר תאריך" is for. Two sharing
 * the latest date are both current; nothing about the data says which won.
 */
export function supersededDocumentIds(docs: SupersedableDocument[]): Set<string> {
  const latestByGroup = new Map<string, string>();
  const groupOf = (doc: SupersedableDocument) => `${doc.entityKey}|${doc.category ?? ""}`;

  for (const doc of docs) {
    if (!doc.entityKey || !doc.validUntil) continue;
    const key = groupOf(doc);
    const current = latestByGroup.get(key);
    if (!current || doc.validUntil > current) latestByGroup.set(key, doc.validUntil);
  }

  const superseded = new Set<string>();
  for (const doc of docs) {
    if (!doc.entityKey || !doc.validUntil) continue;
    const latest = latestByGroup.get(groupOf(doc));
    if (latest && doc.validUntil < latest) superseded.add(doc.id);
  }
  return superseded;
}

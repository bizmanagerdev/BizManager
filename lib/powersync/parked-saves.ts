import { useEffect, useState } from "react";
import type { CommonPowerSyncDatabase } from "@powersync/web";
import { withSentry } from "@/lib/sentry-lazy";
import { useLocalDatabase } from "./store";
import type { DeviceSaveKind, DeviceSaveRequest, OrderRestore } from "./local-writes";

// Saves made on the phone's copy that the server kept failing (server errors
// for PARK_AFTER_MS — lib/powersync/connector.ts) used to be dropped after
// ~30 s, so one stuck save wouldn't freeze the copy: while anything waits to go
// up, PowerSync holds back what comes down. They're kept here instead (audit
// 2026-10-27; owner, 2026-10-28: "yes, build it"): the request exactly as it
// would have gone up, with its Idempotency-Key, so sending it again never
// applies it twice. The copy carries on syncing meanwhile, so the screens show
// the server's version until it has gone up.
//
// They're sent again by themselves (DeviceSaveNotices: every few minutes, when
// the connection comes back, when the app opens) or from the waiting list
// (OfflineBanner → PendingSyncPanel), where one can also be removed. A later
// save of the same row waits behind them, so an older change never lands on
// top of a newer one. A refused one is dropped then, as any refused save is.
// Local only, so logout wipes them with the copy.
//
// Type-only SDK import: the banner reads these through the store, so it never
// pulls the SDK, or the code that sends them, into a page's bundle.

export type ParkedSave = {
  id: string;
  table: string;
  rowId: string;
  request: DeviceSaveRequest;
  key: string;
  restore: OrderRestore | null;
  label: string;
  parkedAt: string;
  tries: number;
  lastError: string | null;
};

/** A save was parked, went up after waiting, or was removed: the banner and the list read again. */
export const PARKED_SAVES_CHANGED_EVENT = "bizh:parked-saves-changed";
/** Send the waiting saves now (the banner's "שלח עכשיו", the list's retry): DeviceSaveNotices does. */
export const PARKED_SAVES_RETRY_EVENT = "bizh:parked-saves-retry";
/** A save was parked: DeviceSaveNotices says so. */
export const DEVICE_SAVE_PARKED_EVENT = "bizh:device-save-parked";
export type DeviceSaveParked = { kind: DeviceSaveKind; label: string };
/** A parked save went up after waiting: DeviceSaveNotices says so. */
export const PARKED_SAVE_SENT_EVENT = "bizh:parked-save-sent";
export type ParkedSaveSent = { kind: DeviceSaveKind; label: string };

/** What each kind of save is, for the waiting list. */
const KIND_WORDS: Record<DeviceSaveKind, string> = {
  "task-status": "סטטוס משימה",
  "task-delete": "מחיקת משימה",
  "task-create": "משימה חדשה",
  "task-update": "עריכת משימה",
  "task-comment": "תגובה למשימה",
  "task-comment-edit": "עריכת תגובה",
  "task-comment-delete": "מחיקת תגובה",
  "task-snooze": "לטיפול בהמשך",
  "customer-create": "לקוח חדש",
  "project-create": "פרויקט חדש",
  "project-update": "עריכת פרויקט",
  "project-status": "סטטוס פרויקט",
  "project-approve-quote": "אישור הצעת מחיר",
  "project-price": "מחיר בסיס לפרויקט",
  "order-create": "הזמנה חדשה",
  "order-update": "עריכת הזמנה",
  "order-payment": "תשלום להזמנה",
  "project-payment": "הכנסה לפרויקט",
  "payment-collected": "סימון גבייה",
  "reminder-action": "עדכון התראה",
  "expense-create": "הוצאה חדשה",
  "income-create": "הכנסה חדשה",
  "ledger-check": "סימון \"נבדק מול הבנק\"",
  "expense-delete": "מחיקת הוצאה",
  "payment-delete": "מחיקת תשלום",
  "order-payment-delete": "מחיקת תשלום להזמנה",
  "worker-payment-delete": "מחיקת תשלום לעובד",
  "loan-delete": "מחיקת הלוואה",
  "repayment-delete": "מחיקת החזר הלוואה",
  "card-charge-delete": "מחיקת חיוב אשראי",
  "transfer-delete": "מחיקת העברה",
};

/** The list's line for a save: its kind, and the row's name when there is one. */
export function parkedLabel(kind: DeviceSaveKind, name: string | null): string {
  const word = KIND_WORDS[kind] ?? "שמירה";
  return name ? `${word}: ${name}` : word;
}

function announce(event: string, detail?: unknown) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(event, { detail }));
}

/** Tell Sentry what happened to a parked save. */
export function reportParked(
  what: "parked" | "went up" | "removed",
  save: { request: DeviceSaveRequest },
  extra: Record<string, unknown> = {}
) {
  withSentry((Sentry) =>
    Sentry.captureMessage(`PowerSync: a device save was ${what === "parked" ? "parked" : `parked and ${what}`}`, {
      level: what === "went up" ? "info" : "warning",
      tags: { area: "powersync", device_save: save.request.kind },
      extra,
    })
  );
}

type Row = {
  id: string;
  tbl: string;
  row_id: string;
  request: string;
  idem_key: string;
  restore: string | null;
  label: string | null;
  parked_at: string;
  tries: number | null;
  last_error: string | null;
};

function fromRow(row: Row): ParkedSave | null {
  try {
    const request = JSON.parse(row.request) as DeviceSaveRequest;
    if (!request || typeof request.url !== "string" || typeof request.kind !== "string") return null;
    return {
      id: row.id,
      table: row.tbl,
      rowId: row.row_id,
      request,
      key: row.idem_key,
      restore: row.restore ? (JSON.parse(row.restore) as OrderRestore) : null,
      label: row.label || parkedLabel(request.kind, null),
      parkedAt: row.parked_at,
      tries: Number(row.tries ?? 0),
      lastError: row.last_error,
    };
  } catch {
    return null;
  }
}

/** Keep a save to send again later (once per Idempotency-Key). */
export async function parkSave(
  db: CommonPowerSyncDatabase,
  save: {
    table: string;
    rowId: string;
    request: DeviceSaveRequest;
    key: string;
    restore: OrderRestore | null;
    label: string;
    error: string;
  }
): Promise<void> {
  const already = await db.getOptional<{ id: string }>("SELECT id FROM parked_saves WHERE idem_key = ?", [save.key]);
  if (!already) {
    const now = new Date().toISOString();
    await db.execute(
      `INSERT INTO parked_saves (id, tbl, row_id, kind, request, idem_key, restore, label, seq, parked_at, tries, last_error, last_try_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, (SELECT coalesce(max(seq), 0) + 1 FROM parked_saves), ?, 0, ?, ?)`,
      [
        crypto.randomUUID(),
        save.table,
        save.rowId,
        save.request.kind,
        JSON.stringify(save.request),
        save.key,
        save.restore ? JSON.stringify(save.restore) : null,
        save.label,
        now,
        save.error,
        now,
      ]
    );
  }
  announce(PARKED_SAVES_CHANGED_EVENT);
}

/** The waiting saves, oldest first. */
export async function listParkedSaves(db: CommonPowerSyncDatabase): Promise<ParkedSave[]> {
  const rows = await db.getAll<Row>("SELECT * FROM parked_saves ORDER BY seq").catch(() => [] as Row[]);
  return rows.map(fromRow).filter((save): save is ParkedSave => save !== null);
}

export async function countParkedSaves(db: CommonPowerSyncDatabase): Promise<number> {
  const row = await db.getOptional<{ n: number }>("SELECT count(*) AS n FROM parked_saves").catch(() => null);
  return row?.n ?? 0;
}

/** Whether a save of this row is waiting (a later one then waits behind it). */
export async function hasParkedFor(db: CommonPowerSyncDatabase, table: string, rowId: string): Promise<boolean> {
  const row = await db.getOptional<{ id: string }>("SELECT id FROM parked_saves WHERE tbl = ? AND row_id = ? LIMIT 1", [
    table,
    rowId,
  ]);
  return Boolean(row);
}

/** One more try that didn't get through. */
export async function noteParkedTry(db: CommonPowerSyncDatabase, id: string, error: string): Promise<void> {
  await db.execute("UPDATE parked_saves SET tries = coalesce(tries, 0) + 1, last_error = ?, last_try_at = ? WHERE id = ?", [
    error,
    new Date().toISOString(),
    id,
  ]);
}

/** Done with a parked save: it went up, was refused, or the person removed it. */
export async function removeParkedSave(db: CommonPowerSyncDatabase, id: string): Promise<void> {
  await db.execute("DELETE FROM parked_saves WHERE id = ?", [id]);
  announce(PARKED_SAVES_CHANGED_EVENT);
}

/** Ask the device copy to send the waiting saves now. */
export function requestParkedRetry() {
  announce(PARKED_SAVES_RETRY_EVENT);
}

/** How often the waiting saves are read again while the page is on screen (a retry elsewhere raises no event here). */
const POLL_MS = 5000;

/** The saves waiting to go up again, kept current. Empty for people without a copy. */
export function useParkedSaves(): ParkedSave[] {
  const db = useLocalDatabase();
  const [saves, setSaves] = useState<ParkedSave[]>([]);

  useEffect(() => {
    if (!db) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSaves([]);
      return;
    }
    let cancelled = false;
    const read = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void listParkedSaves(db).then((list) => {
        if (cancelled) return;
        setSaves((prev) =>
          prev.length === list.length && prev.every((save, i) => save.id === list[i].id && save.tries === list[i].tries)
            ? prev
            : list
        );
      });
    };
    read();
    const timer = window.setInterval(read, POLL_MS);
    window.addEventListener(PARKED_SAVES_CHANGED_EVENT, read);
    document.addEventListener("visibilitychange", read);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener(PARKED_SAVES_CHANGED_EVENT, read);
      document.removeEventListener("visibilitychange", read);
    };
  }, [db]);

  return saves;
}

/** Announce a save parked (DeviceSaveNotices: a toast). */
export function announceParked(detail: DeviceSaveParked) {
  announce(DEVICE_SAVE_PARKED_EVENT, detail);
}

/** Announce a parked save that went up after waiting (DeviceSaveNotices: a toast). */
export function announceParkedSent(detail: ParkedSaveSent) {
  announce(PARKED_SAVE_SENT_EVENT, detail);
}

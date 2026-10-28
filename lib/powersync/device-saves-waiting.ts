import { useEffect, useRef, useState } from "react";
import type { CommonPowerSyncDatabase } from "@powersync/web";
import { useLocalDatabase, useLocalSyncStatus } from "./store";

// The saves made on the phone's own copy (PowerSync) that haven't reached the
// server yet — for the red bar's "פרטים" list, beside the older offline queue
// (owner, 2026-10-11: a task added in airplane mode was saved and went up when
// the signal came back, but the list didn't show it; "show the stuff that needs
// to be uploaded, from all types, everywhere"). They wait in PowerSync's own
// upload queue (the ps_crud table), one row per change; PowerSync sends them by
// itself when the connection is back (lib/powersync/connector.ts).
//
// Type-only SDK import: this reads the open database through the store, so it
// never pulls the SDK into a page's bundle.

export type DeviceSaveWaiting = {
  /** table:id — several changes to one row are one line. */
  key: string;
  label: string;
  /** What happened to the row: new, changed, or removed. */
  change: "new" | "changed" | "removed";
};

/** Each table the phone saves to: what it's called, and how to find the row's name. */
const KINDS: Record<string, { word: string; nameSql?: string }> = {
  tasks: { word: "משימה", nameSql: "SELECT subject AS name FROM tasks WHERE id = ?" },
  task_comments: {
    word: "תגובה למשימה",
    nameSql: "SELECT t.subject AS name FROM task_comments c JOIN tasks t ON t.id = c.task_id WHERE c.id = ?",
  },
  task_snoozes: {
    word: "לטיפול בהמשך",
    nameSql: "SELECT t.subject AS name FROM task_snoozes s JOIN tasks t ON t.id = s.task_id WHERE s.id = ?",
  },
  reminders: { word: "תזכורת", nameSql: "SELECT COALESCE(title, content) AS name FROM reminders WHERE id = ?" },
  projects: { word: "פרויקט", nameSql: "SELECT name FROM projects WHERE id = ?" },
  customers: { word: "לקוח", nameSql: "SELECT name FROM customers WHERE id = ?" },
  orders: {
    word: "הזמנה",
    nameSql: "SELECT c.name AS name FROM orders o LEFT JOIN customers c ON c.id = o.customer_id WHERE o.id = ?",
  },
  order_items: {
    word: "שורה בהזמנה",
    nameSql:
      "SELECT c.name AS name FROM order_items i JOIN orders o ON o.id = i.order_id LEFT JOIN customers c ON c.id = o.customer_id WHERE i.id = ?",
  },
  payments: { word: "תשלום" },
  inventory: { word: "מלאי" },
};

/** Lines shown at most; the count stays exact. */
const MAX_ROWS = 200;

/** The name the list shows for a row (a task's subject, an order's customer), or null. */
export async function rowName(db: CommonPowerSyncDatabase, table: string, id: string): Promise<string | null> {
  const nameSql = KINDS[table]?.nameSql;
  if (!nameSql) return null;
  const found = await db.getOptional<{ name: string | null }>(nameSql, [id]).catch(() => null);
  return found?.name?.trim() || null;
}

type CrudRow = { data: string };
type CrudOp = { op?: string; type?: string; id?: string };

/** How many rows have changes waiting — the lines of the list (0 when there's no copy or it can't be read). */
export async function countDeviceSavesWaiting(db: CommonPowerSyncDatabase): Promise<number> {
  const row = await db
    .getOptional<{ n: number }>(
      "SELECT count(DISTINCT json_extract(data, '$.type') || ':' || json_extract(data, '$.id')) AS n FROM ps_crud"
    )
    .catch(() => null);
  return row?.n ?? 0;
}

/** The waiting changes, one line per row changed, oldest first. */
export async function readDeviceSavesWaiting(db: CommonPowerSyncDatabase): Promise<DeviceSaveWaiting[]> {
  const rows = await db.getAll<CrudRow>(`SELECT data FROM ps_crud ORDER BY id LIMIT ${MAX_ROWS}`).catch(() => [] as CrudRow[]);
  const byRow = new Map<string, { table: string; id: string; ops: Set<string> }>();
  for (const row of rows) {
    let op: CrudOp;
    try {
      op = JSON.parse(row.data) as CrudOp;
    } catch {
      continue;
    }
    if (!op.type || !op.id) continue;
    const key = `${op.type}:${op.id}`;
    const entry = byRow.get(key) ?? { table: op.type, id: op.id, ops: new Set<string>() };
    if (op.op) entry.ops.add(op.op);
    byRow.set(key, entry);
  }

  const lines: DeviceSaveWaiting[] = [];
  for (const [key, entry] of byRow) {
    const word = KINDS[entry.table]?.word ?? "שינוי";
    const name = await rowName(db, entry.table, entry.id);
    const change = entry.ops.has("DELETE") ? "removed" : entry.ops.has("PUT") ? "new" : "changed";
    lines.push({ key, label: name ? `${word}: ${name}` : word, change });
  }
  return lines;
}

/** How often the count is read while the page is on screen. */
const POLL_MS = 2500;
/**
 * With a connection, a save waits only a moment before PowerSync sends it; the
 * bar would flash after every save. Online, a save counts as waiting only once
 * it has been waiting this long (with no connection, at once).
 */
const STUCK_MS = 15_000;

export type DeviceSavesWaiting = {
  /** Rows with changes waiting right now. */
  count: number;
  /** Some have been waiting for STUCK_MS or more. */
  stuck: boolean;
};

/**
 * The saves waiting on this device's copy, kept current: read now, whenever the
 * copy's sync state changes (an upload starts or ends), and every few seconds
 * while the page is visible — a save made with no signal changes nothing else.
 * Zero for people without a copy.
 */
export function useDeviceSavesWaiting(): DeviceSavesWaiting {
  const db = useLocalDatabase();
  const status = useLocalSyncStatus();
  const [waiting, setWaiting] = useState<DeviceSavesWaiting>({ count: 0, stuck: false });
  // Kept across re-reads: an upload that keeps failing flips the sync state (and
  // re-runs the effect) on every try, and mustn't restart the clock.
  const waitingSince = useRef(0);

  useEffect(() => {
    if (!db) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setWaiting({ count: 0, stuck: false });
      return;
    }
    let cancelled = false;
    const read = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void countDeviceSavesWaiting(db).then((count) => {
        if (cancelled) return;
        if (count === 0) waitingSince.current = 0;
        else if (!waitingSince.current) waitingSince.current = Date.now();
        const stuck = count > 0 && Date.now() - waitingSince.current >= STUCK_MS;
        setWaiting((prev) => (prev.count === count && prev.stuck === stuck ? prev : { count, stuck }));
      });
    };
    read();
    const timer = window.setInterval(read, POLL_MS);
    document.addEventListener("visibilitychange", read);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", read);
    };
  }, [db, status?.uploading, status?.connected]);

  return waiting;
}

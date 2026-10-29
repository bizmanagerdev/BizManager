import type { CommonPowerSyncDatabase } from "@powersync/web";

// The device copy's own id, in the Idempotency-Key of every change it sends
// (lib/powersync/connector.ts). The key was the row, the change and its
// number in the copy's upload queue — and that number starts again from 1
// when the copy is wiped (sign-out) or made on a new device: a later change
// could get an earlier one's key, and the server answered it "already done"
// without saving it (audit 2026-10-27; owner, 2026-10-29: "yes, build it").
// The id is random, kept in the copy (local only, so a wipe takes it), and
// made again for the next copy — a key never comes round again.

export type DeviceCopyId = {
  id: string;
  /** The changes waiting when the id was made (up to this number) keep the key they may have been sent with already. */
  fromChange: number;
};

type Row = { copy_id: unknown; from_change: unknown };

const read = (db: CommonPowerSyncDatabase) =>
  db.getOptional<Row>("SELECT copy_id, from_change FROM device_copy WHERE id = 'this'");

const valid = (row: Row | null): DeviceCopyId | null =>
  row && typeof row.copy_id === "string" && row.copy_id
    ? { id: row.copy_id, fromChange: Number(row.from_change) || 0 }
    : null;

/**
 * This copy's id — made the first time it's asked for (the copy opens:
 * openLocalDatabase), as one statement, so two asking at once get the same
 * one. Null if it can't be read or made: the keys stay as they were.
 */
export async function deviceCopyId(db: CommonPowerSyncDatabase): Promise<DeviceCopyId | null> {
  try {
    const kept = valid(await read(db));
    if (kept) return kept;
    await db.execute(
      "INSERT OR IGNORE INTO device_copy (id, copy_id, from_change) VALUES ('this', ?, (SELECT coalesce(max(id), 0) FROM ps_crud))",
      [crypto.randomUUID()]
    );
    return valid(await read(db));
  } catch {
    return null;
  }
}

/** One change's Idempotency-Key: the same change always the same key, two changes never one. */
export function changeKey(copy: DeviceCopyId | null, op: { table: string; id: string; op: string; clientId: number }): string {
  const own = `${op.table}:${op.id}:${op.op}:${op.clientId}`;
  return copy && op.clientId > copy.fromChange ? `ps:${copy.id}:${own}` : `ps:${own}`;
}

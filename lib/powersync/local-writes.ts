import type { AbstractPowerSyncDatabase, CrudEntry } from "@powersync/web";

// Saves made on the device copy first ("instant saves"): the change is written
// into the person's own copy — so every page drawn from it shows it at once —
// and PowerSync queues it and hands it to BizConnector.uploadData, which sends
// it through the SAME API route the page used before (permission checks,
// reminder closing, the history log). With no signal it waits and goes when
// the connection is back. If the server refuses it, the change is dropped and
// the copy goes back to the server's version at the next sync.
//
// Only the tasks board's moves, reorders and deletes so far; creating and
// editing a task still go straight to the server.

type Db = Pick<AbstractPowerSyncDatabase, "execute">;

/** A card moved: to another column and/or another position in it. */
export async function moveTaskOnDevice(db: Db, id: string, status: string, sortOrder: number): Promise<void> {
  await db.execute("UPDATE tasks SET status = ?, sort_order = ?, updated_at = ? WHERE id = ?", [
    status,
    sortOrder,
    new Date().toISOString(),
    id,
  ]);
}

/** A card deleted. */
export async function deleteTaskOnDevice(db: Db, id: string): Promise<void> {
  await db.execute("DELETE FROM tasks WHERE id = ?", [id]);
}

/** What a device save turned into on the server. */
export type DeviceSaveKind = "task-status" | "task-delete";

/** One queued device save, as the API route it goes through. */
export type DeviceSaveRequest = { kind: DeviceSaveKind; url: string; body: Record<string, unknown> };

/**
 * The API call for one queued change, or null for a change nothing sends
 * (it's dropped and reported). `currentStatus` reads the row's status for a
 * reorder the queue recorded without it (the route always wants one).
 */
export async function requestForChange(
  op: Pick<CrudEntry, "table" | "op" | "id" | "opData">,
  currentStatus: (id: string) => Promise<string | null>
): Promise<DeviceSaveRequest | null> {
  if (op.table !== "tasks") return null;
  // UpdateType's values, compared as text so this file doesn't pull the SDK
  // into the page (the page only uses the two writes above).
  const kind: string = op.op;
  if (kind === "DELETE") return { kind: "task-delete", url: "/api/tasks/delete", body: { id: op.id } };
  if (kind !== "PATCH") return null;
  const data = op.opData ?? {};
  const status = typeof data.status === "string" ? data.status : await currentStatus(op.id);
  const sortOrder = data.sort_order === null || data.sort_order === undefined ? null : Number(data.sort_order);
  return {
    kind: "task-status",
    url: "/api/tasks/update-status",
    body: {
      id: op.id,
      status: status ?? "todo",
      ...(sortOrder !== null && Number.isFinite(sortOrder) ? { sort_order: sortOrder } : {}),
    },
  };
}

/** The event pages listen for when the server refused a device save. */
export const DEVICE_SAVE_REFUSED_EVENT = "bizh:device-save-refused";
export type DeviceSaveRefused = { kind: DeviceSaveKind; message: string };

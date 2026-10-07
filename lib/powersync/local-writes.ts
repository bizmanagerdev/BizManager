import type { AbstractPowerSyncDatabase, CrudEntry } from "@powersync/web";
import { computeInsertSortOrder } from "@/lib/tasks/sortOrder";
import {
  newCustomerRow,
  parseNewCustomerBranches,
  parseNewCustomerContacts,
  type NewCustomerInput,
} from "@/lib/customers/new-customer";

// Saves made on the device copy first ("instant saves"): the change is written
// into the person's own copy — so every page drawn from it shows it at once —
// and PowerSync queues it and hands it to BizConnector.uploadData, which sends
// it through the SAME API route the page used before (permission checks,
// notifications, translations, reminder closing, the history log). With no
// signal it waits and goes when the connection is back. If the server refuses
// it, the change is dropped and the copy goes back to the server's version at
// the next sync.
//
// Tasks: created (the + menu, the board's quick add, the task form), edited in
// the task form (its fields, members and tags), moved / reordered / marked
// done anywhere, deleted; and comments added. A new task or comment gets its
// id here (the routes accept it), so it's the same row once the server has it.
//
// What isn't a column of the row — a task's members, tags and the reminders
// set while creating it — rides in the row's local-only `_extras` column
// (lib/powersync/schema.ts; the server never sends it, so a sync clears it),
// so it goes up in the same queue, in order, with the change it belongs to.

type Db = Pick<AbstractPowerSyncDatabase, "execute" | "getOptional">;

/** A task's own fields, as the task routes take them. */
export type TaskFields = {
  subject: string;
  description: string | null;
  due_date: string | null;
  due_time: string | null;
  city: string | null;
  address: string | null;
  assigned_user_id: string | null;
  priority: string;
  status: string;
  business_domain: string;
  project_id: string | null;
  property_id: string | null;
  customer_id: string | null;
  is_private: boolean;
};

/** What goes with a task's change that isn't a column of it. */
export type TaskExtras = {
  member_ids?: string[];
  tag_ids?: string[];
  /** Set while creating it (on a saved task each reminder is written on its own). */
  reminders?: { remind_at: string; content: string | null }[];
};

const TASK_FIELD_COLUMNS = [
  "subject", "description", "due_date", "due_time", "city", "address", "assigned_user_id", "priority", "status",
  "business_domain", "project_id", "property_id", "customer_id", "is_private",
] as const satisfies readonly (keyof TaskFields)[];

const LINK_COLUMNS = ["business_domain", "project_id", "property_id"] as const;

/** PowerSync stores a boolean as 1/0. */
function sqlValue(value: unknown): unknown {
  return typeof value === "boolean" ? (value ? 1 : 0) : value;
}

/** The extras as stored — with a nonce, so the same extras set twice are still two changes. */
function extrasJson(extras: TaskExtras): string {
  return JSON.stringify({ ...extras, n: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` });
}

/** A new task on the device copy, at the top of its column (as the server puts it). Returns its id. */
export async function createTaskOnDevice(
  db: Db,
  task: { id: string; fields: TaskFields; extras?: TaskExtras; creatorId: string }
): Promise<string> {
  const { fields } = task;
  const top = await db.getOptional<{ sort_order: number | null }>(
    fields.status === "todo"
      ? "SELECT min(sort_order) AS sort_order FROM tasks WHERE status = 'todo' OR status IS NULL"
      : "SELECT min(sort_order) AS sort_order FROM tasks WHERE status = ?",
    fields.status === "todo" ? [] : [fields.status]
  );
  const columns = [...TASK_FIELD_COLUMNS, "private_owner_id", "sort_order", "created_at", "_extras"];
  const values = [
    ...TASK_FIELD_COLUMNS.map((column) => sqlValue(fields[column])),
    task.creatorId,
    computeInsertSortOrder(null, top?.sort_order ?? null),
    new Date().toISOString(),
    extrasJson(task.extras ?? {}),
  ];
  await db.execute(
    `INSERT INTO tasks (id, ${columns.join(", ")}) VALUES (?, ${columns.map(() => "?").join(", ")})`,
    [task.id, ...values]
  );
  return task.id;
}

/** A task's fields and/or members and tags changed (the task form). */
export async function updateTaskOnDevice(
  db: Db,
  id: string,
  changes: Partial<TaskFields>,
  extras?: Pick<TaskExtras, "member_ids" | "tag_ids">
): Promise<void> {
  const columns = TASK_FIELD_COLUMNS.filter((column) => column in changes);
  const sets = columns.map((column) => `${column} = ?`);
  const values: unknown[] = columns.map((column) => sqlValue(changes[column]));
  if (extras && (extras.member_ids || extras.tag_ids)) {
    sets.push("_extras = ?");
    values.push(extrasJson(extras));
  }
  if (sets.length === 0) return;
  await db.execute(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`, [...values, id]);
}

/** A task marked done, reopened, or moved to another column (anywhere but the board's drag). */
export async function setTaskStatusOnDevice(db: Db, id: string, status: string): Promise<void> {
  await db.execute("UPDATE tasks SET status = ? WHERE id = ?", [status, id]);
}

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

/** A comment added to a task. */
export async function addCommentOnDevice(
  db: Db,
  comment: { id: string; taskId: string; authorId: string; body: string }
): Promise<void> {
  await db.execute("INSERT INTO task_comments (id, task_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)", [
    comment.id,
    comment.taskId,
    comment.authorId,
    comment.body,
    new Date().toISOString(),
  ]);
}

// ── Customers ────────────────────────────────────────────────────────────────
// Created on the phone first (the + menu's customer form, the new-customer
// form inside the project / order forms). The row is the one the server
// makes (lib/customers/new-customer.ts); its street, tags, contacts and
// branches ride in `_extras` and go up with it in one request — the route
// creates them right after the customer. They show once it's there.

/** A new customer on the device copy. */
export async function createCustomerOnDevice(db: Db, customer: { id: string; input: NewCustomerInput }): Promise<void> {
  const { input } = customer;
  const row = { ...newCustomerRow(input), linked_user_id: input.linked_user_id };
  const extras = {
    street: input.street,
    tag_ids: input.tag_ids,
    contacts: input.contacts,
    branches: input.branches,
    n: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  };
  const columns = [...Object.keys(row), "created_at", "_extras"];
  const values = [...Object.values(row).map(sqlValue), new Date().toISOString(), JSON.stringify(extras)];
  await db.execute(
    `INSERT INTO customers (id, ${columns.join(", ")}) VALUES (?, ${columns.map(() => "?").join(", ")})`,
    [customer.id, ...values]
  );
}

function customerCreateBody(id: string, data: Record<string, unknown>): Record<string, unknown> {
  let extras: Record<string, unknown> = {};
  try {
    extras = typeof data._extras === "string" && data._extras ? (JSON.parse(data._extras) as Record<string, unknown>) : {};
  } catch {
    extras = {};
  }
  const flag = (value: unknown) => value === 1 || value === true;
  return {
    id,
    name: data.name ?? "",
    name_for_invoice: data.name_for_invoice ?? null,
    registration_number: data.registration_number ?? null,
    phone: data.phone ?? null,
    whatsapp: data.whatsapp ?? null,
    email: data.email ?? null,
    city: data.city ?? "",
    address: typeof extras.street === "string" ? extras.street : null,
    notes: data.notes ?? null,
    requires_prepayment: flag(data.requires_prepayment),
    linked_user_id: data.linked_user_id ?? null,
    tag_ids: Array.isArray(extras.tag_ids) ? extras.tag_ids.filter((v): v is string => typeof v === "string") : [],
    contacts: parseNewCustomerContacts(extras.contacts),
    branches: parseNewCustomerBranches(extras.branches),
  };
}

/** What a device save turned into on the server. */
export type DeviceSaveKind =
  | "task-status"
  | "task-delete"
  | "task-create"
  | "task-update"
  | "task-comment"
  | "customer-create";

/** One queued device save, as the API route it goes through. */
export type DeviceSaveRequest = { kind: DeviceSaveKind; url: string; body: Record<string, unknown> };

/** The row as it stands on the device now (what a change that didn't record a column needs). */
export type CurrentTaskRow = (id: string) => Promise<Record<string, unknown> | null>;

function parseExtras(value: unknown): TaskExtras {
  if (typeof value !== "string" || !value) return {};
  try {
    const parsed = JSON.parse(value) as TaskExtras & { n?: unknown };
    const out: TaskExtras = {};
    if (Array.isArray(parsed.member_ids)) out.member_ids = parsed.member_ids.filter((v): v is string => typeof v === "string");
    if (Array.isArray(parsed.tag_ids)) out.tag_ids = parsed.tag_ids.filter((v): v is string => typeof v === "string");
    if (Array.isArray(parsed.reminders)) out.reminders = parsed.reminders;
    return out;
  } catch {
    return {};
  }
}

/** A task's fields out of a queued change, in the routes' shape (only those it holds). */
function taskFieldsOf(data: Record<string, unknown>): Partial<Record<keyof TaskFields, unknown>> {
  const out: Partial<Record<keyof TaskFields, unknown>> = {};
  for (const column of TASK_FIELD_COLUMNS) {
    if (!(column in data)) continue;
    const value = data[column];
    out[column] = column === "is_private" ? value === 1 || value === true : value ?? null;
  }
  return out;
}

/**
 * The API call for one queued change, or null for a change nothing sends
 * (it's dropped and reported). `current` reads the task as it stands on the
 * device — for what the route wants that the change didn't record (the
 * status, for a reorder; the whole link, when part of it changed).
 */
export async function requestForChange(
  op: Pick<CrudEntry, "table" | "op" | "id" | "opData">,
  current: CurrentTaskRow
): Promise<DeviceSaveRequest | null> {
  // UpdateType's values, compared as text so this file doesn't pull the SDK
  // into the page (the page only uses the writes above).
  const kind: string = op.op;
  const data = op.opData ?? {};

  if (op.table === "task_comments") {
    if (kind !== "PUT") return null;
    return {
      kind: "task-comment",
      url: "/api/tasks/add-comment",
      body: { id: op.id, task_id: data.task_id, message: data.body },
    };
  }
  if (op.table === "customers") {
    // Only creating one is saved on the phone so far (edits still go to the server).
    if (kind !== "PUT") return null;
    return { kind: "customer-create", url: "/api/customers/create", body: customerCreateBody(op.id, data) };
  }
  if (op.table !== "tasks") return null;

  if (kind === "DELETE") return { kind: "task-delete", url: "/api/tasks/delete", body: { id: op.id } };

  const extras = parseExtras(data._extras);
  if (kind === "PUT") {
    return { kind: "task-create", url: "/api/tasks/create", body: { id: op.id, ...taskFieldsOf(data), ...extras } };
  }
  if (kind !== "PATCH") return null;

  const fields = taskFieldsOf(data);
  const fieldNames = Object.keys(fields);
  const hasExtras = Boolean(extras.member_ids || extras.tag_ids);

  // A move / reorder / done tick: the status route (it keeps a reorder out of the history).
  if (!hasExtras && fieldNames.every((name) => name === "status")) {
    const sortOrder = data.sort_order === null || data.sort_order === undefined ? null : Number(data.sort_order);
    if (fieldNames.length === 0 && sortOrder === null) return null; // nothing the server keeps
    const status = typeof data.status === "string" ? data.status : ((await current(op.id))?.status as string | null | undefined);
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

  // An edit in the task form. The domain and its project/property are checked
  // together by the server: a change to any of them goes up with all three.
  const body: Record<string, unknown> = { id: op.id, ...fields };
  if (LINK_COLUMNS.some((column) => column in fields)) {
    const row = await current(op.id);
    for (const column of LINK_COLUMNS) if (!(column in body)) body[column] = row?.[column] ?? null;
  }
  if (extras.member_ids) body.member_ids = extras.member_ids;
  if (extras.tag_ids) body.tag_ids = extras.tag_ids;
  return { kind: "task-update", url: "/api/tasks/update", body };
}

/** The event pages listen for when the server refused a device save. */
export const DEVICE_SAVE_REFUSED_EVENT = "bizh:device-save-refused";
export type DeviceSaveRefused = { kind: DeviceSaveKind; message: string };

/** The event fired when a device save has reached the server (pages drawn by the server can refresh). */
export const DEVICE_SAVE_SENT_EVENT = "bizh:device-save-sent";
export type DeviceSaveSent = { kind: DeviceSaveKind; id: string };

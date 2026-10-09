import { readyDeviceSaves } from "@/lib/powersync/store";
import { offlineFetch, type OfflineFetchResult } from "@/lib/offline-queue";
import {
  addCommentOnDevice,
  deleteCommentOnDevice,
  editCommentOnDevice,
  snoozeTaskOnDevice,
  createTaskOnDevice,
  deleteTaskOnDevice,
  moveTaskOnDevice,
  setTaskStatusOnDevice,
  updateTaskOnDevice,
  type TaskExtras,
  type TaskFields,
} from "@/lib/powersync/local-writes";

// Task saves that go to the on-device copy first (lib/powersync/local-writes.ts):
// instant on screen, sent in the background through the same API routes, and
// waiting for the connection when there's none. Null when this device doesn't
// save there — no complete copy yet, or the person's task pages aren't drawn
// from it — and the caller saves on the server as before.

/** The task form's create/update body (components/tasks/TaskUpsertDialog.helpers.ts buildTaskPayload). */
type TaskFormPayload = Partial<{
  business_domain: string | null;
  project_id: string | null;
  property_id: string | null;
  customer_id: string | null;
  subject: string;
  description: string | null;
  due_date: string | null;
  due_time: string | null;
  city: string | null;
  address: string | null;
  assigned_user_id: string | null;
  member_ids: string[];
  tag_ids: string[];
  reminders: { remind_at: string; content: string | null }[];
  priority: string;
  status: string;
  is_private: boolean;
}>;

const FIELD_KEYS = [
  "subject", "description", "due_date", "due_time", "city", "address", "assigned_user_id", "priority", "status",
  "business_domain", "project_id", "property_id", "customer_id", "is_private",
] as const;

/** The row a new task gets — what the routes answer with, for the page's own "created" handling. */
export type CreatedTask = TaskFields & { id: string; created_at: string };

export type DeviceTaskSaves = {
  /** A new task (the server's defaults filled in the same way); returns the row. */
  create: (payload: TaskFormPayload) => Promise<CreatedTask>;
  /** An edit: only the fields given, plus members / tags when they changed. */
  update: (id: string, diff: TaskFormPayload) => Promise<void>;
  setStatus: (id: string, status: string) => Promise<void>;
  move: (id: string, status: string, sortOrder: number) => Promise<void>;
  remove: (id: string) => Promise<void>;
  addComment: (taskId: string, body: string) => Promise<{ id: string; author_id: string; body: string; created_at: string }>;
  editComment: (id: string, body: string) => Promise<void>;
  deleteComment: (id: string) => Promise<void>;
};

export function deviceTaskSaves(): DeviceTaskSaves | null {
  const ready = readyDeviceSaves();
  if (!ready) return null;
  const { db, viewerId } = ready;
  return {
    async create(payload) {
      // The route's own defaults (app/api/tasks/create): general business, the
      // creator as assignee, medium, to do.
      const fields: TaskFields = {
        subject: (payload.subject ?? "").trim(),
        description: payload.description ?? null,
        due_date: payload.due_date ?? null,
        due_time: payload.due_time ?? null,
        city: payload.city ?? null,
        address: payload.address ?? null,
        assigned_user_id: payload.assigned_user_id || viewerId,
        priority: payload.priority || "medium",
        status: payload.status || "todo",
        business_domain: payload.business_domain || "general_business",
        project_id: payload.project_id ?? null,
        property_id: payload.property_id ?? null,
        customer_id: payload.customer_id ?? null,
        is_private: payload.is_private === true,
      };
      const extras: TaskExtras = {
        member_ids: payload.member_ids ?? [],
        tag_ids: payload.tag_ids ?? [],
        reminders: payload.reminders ?? [],
      };
      const id = crypto.randomUUID();
      await createTaskOnDevice(db, { id, fields, extras, creatorId: viewerId });
      return { ...fields, id, created_at: new Date().toISOString() };
    },
    async update(id, diff) {
      const changes: Partial<TaskFields> = {};
      for (const key of FIELD_KEYS) {
        if (key in diff) (changes as Record<string, unknown>)[key] = diff[key] ?? null;
      }
      await updateTaskOnDevice(db, id, changes, {
        ...("member_ids" in diff ? { member_ids: diff.member_ids ?? [] } : {}),
        ...("tag_ids" in diff ? { tag_ids: diff.tag_ids ?? [] } : {}),
      });
    },
    setStatus: (id, status) => setTaskStatusOnDevice(db, id, status),
    move: (id, status, sortOrder) => moveTaskOnDevice(db, id, status, sortOrder),
    remove: (id) => deleteTaskOnDevice(db, id),
    async addComment(taskId, body) {
      const comment = { id: crypto.randomUUID(), taskId, authorId: viewerId, body };
      await addCommentOnDevice(db, comment);
      return { id: comment.id, author_id: viewerId, body, created_at: new Date().toISOString() };
    },
    editComment: (id, body) => editCommentOnDevice(db, id, body),
    deleteComment: (id) => deleteCommentOnDevice(db, id),
  };
}

/**
 * "לטיפול בהמשך" from anywhere (the board's card, the task itself, the
 * dashboard): the person's snooze of a task until a time, or the task back
 * now (until null) — on the device copy when there is one (the lists drawn
 * from it update by themselves), else the route.
 */
export async function saveTaskSnooze(
  taskId: string,
  until: string | null,
  offlineLabel: string
): Promise<OfflineFetchResult & { onDevice: boolean }> {
  const ready = readyDeviceSaves();
  if (ready) {
    await snoozeTaskOnDevice(ready.db, { taskId, userId: ready.viewerId, until });
    return { queued: false, ok: true, data: null, onDevice: true };
  }
  return {
    ...(await offlineFetch("/api/tasks/snooze", { task_id: taskId, until }, offlineLabel, { idempotent: true })),
    onDevice: false,
  };
}

/**
 * A task marked done / reopened from anywhere (the dashboard, a project page,
 * the inbox): on the device copy when there is one, else the status route as
 * before — offlineFetch's answer either way, plus `onDevice`: saved on the
 * copy, so the page needn't read the server again now (pages drawn from the
 * copy show it; the others refresh once it has reached the server —
 * components/powersync/DeviceSaveNotices). `offlineLabel`: the queue's label
 * for the server path.
 */
export async function saveTaskStatus(
  id: string,
  status: string,
  offlineLabel: string
): Promise<OfflineFetchResult & { onDevice: boolean }> {
  const device = deviceTaskSaves();
  if (device) {
    await device.setStatus(id, status);
    return { queued: false, ok: true, data: null, onDevice: true };
  }
  return { ...(await offlineFetch("/api/tasks/update-status", { id, status }, offlineLabel)), onDevice: false };
}

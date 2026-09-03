import { toast } from "sonner";

/**
 * System-wide "undo" engine. Delete/edit actions are DEFERRED: the UI updates
 * immediately, but the real mutation (the same API route/server action/Supabase
 * call already used everywhere) is held in a timer for `windowMs`. If undone,
 * the timer is just cancelled — nothing ever reached the database, so no
 * schema changes or per-entity restore logic are needed. Create actions can't
 * be deferred (they need a real id from the server), so they use a separate
 * "reversible" mode: the create already happened, and undo calls the entity's
 * existing delete function immediately.
 *
 * Deliberately a module-level singleton, not React state: pending timers must
 * survive client-side navigation between pages, and the write side needs to be
 * a plain importable function reachable from every call site without a
 * provider. Mirrors the module-singleton shape of lib/offline-queue.ts.
 */

const DEFAULT_WINDOW_MS = 10000;

export type ActionResult = { ok: true } | { ok: false; error?: string };

type BaseEntry = {
  key: string;
  message: string;
  windowMs: number;
  timer: ReturnType<typeof setTimeout>;
};
type DeferredEntry = BaseEntry & {
  kind: "deferred";
  onCommit: () => Promise<ActionResult>;
  onRevert: () => void;
};
type ReversibleEntry = BaseEntry & {
  kind: "reversible";
  onUndo: () => Promise<ActionResult> | void;
};
type Entry = DeferredEntry | ReversibleEntry;

const pending = new Map<string, Entry>();
const order: string[] = []; // push on schedule, most-recent-last

const listeners = new Set<() => void>();
let version = 0;
function notify() {
  version++;
  for (const l of listeners) l();
}
/** For hooks that need to re-render when overlay state changes (see useUndoOverlay). */
export function subscribeUndo(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
export function getUndoVersion() {
  return version;
}

// ── overlay state — lets props-only list components show optimistic
// hide/patch without copying server data into local React state. ──
const hiddenIds = new Map<string, Set<string>>(); // scope -> ids currently hidden
const patchedFields = new Map<string, Map<string, object>>(); // scope -> id -> patch

export function isUndoHidden(scope: string, id: string): boolean {
  return hiddenIds.get(scope)?.has(id) ?? false;
}
export function getUndoPatch(scope: string, id: string): object | undefined {
  return patchedFields.get(scope)?.get(id);
}
function markHidden(scope: string, id: string) {
  let set = hiddenIds.get(scope);
  if (!set) {
    set = new Set();
    hiddenIds.set(scope, set);
  }
  set.add(id);
}
function unmarkHidden(scope: string, id: string) {
  hiddenIds.get(scope)?.delete(id);
}
function setPatch(scope: string, id: string, patch: object) {
  let map = patchedFields.get(scope);
  if (!map) {
    map = new Map();
    patchedFields.set(scope, map);
  }
  map.set(id, patch);
}
function clearPatch(scope: string, id: string) {
  patchedFields.get(scope)?.delete(id);
}

function finish(key: string) {
  pending.delete(key);
  const i = order.indexOf(key);
  if (i !== -1) order.splice(i, 1);
}

async function fire(key: string) {
  const entry = pending.get(key);
  if (!entry) return;
  finish(key);
  notify();
  if (entry.kind === "deferred") {
    const result = await entry.onCommit().catch(
      (e): ActionResult => ({ ok: false, error: e instanceof Error ? e.message : String(e) })
    );
    if (!result.ok) {
      entry.onRevert();
      notify();
      toast.error(result.error || "הפעולה נכשלה.");
    }
  }
  // reversible (create) entries need no action on natural expiry — already committed.
}

function pushEntry(key: string, entry: Entry) {
  const existing = pending.get(key);
  if (existing) clearTimeout(existing.timer);
  pending.set(key, entry);
  const i = order.indexOf(key);
  if (i !== -1) order.splice(i, 1);
  order.push(key);
  notify();
}

/** Core primitive for delete/edit: optimistic now, real mutation after windowMs unless undone. */
export function scheduleDeferredAction(args: {
  key: string;
  message: string;
  windowMs?: number;
  onApplyOptimistic: () => void;
  onCommit: () => Promise<ActionResult>;
  onRevert: () => void;
}) {
  const windowMs = args.windowMs ?? DEFAULT_WINDOW_MS;
  args.onApplyOptimistic();
  const timer = setTimeout(() => void fire(args.key), windowMs);
  pushEntry(args.key, {
    kind: "deferred",
    key: args.key,
    message: args.message,
    windowMs,
    timer,
    onCommit: args.onCommit,
    onRevert: args.onRevert,
  });
  toast.success(args.message, {
    id: args.key,
    duration: windowMs,
    action: { label: "בטל", onClick: () => undoKey(args.key) },
  });
}

/** Core primitive for create: already committed, undo replays a real reverse call. */
export function registerReversibleAction(args: {
  key: string;
  message: string;
  windowMs?: number;
  onUndo: () => Promise<ActionResult> | void;
}) {
  const windowMs = args.windowMs ?? DEFAULT_WINDOW_MS;
  const timer = setTimeout(() => finish(args.key), windowMs);
  pushEntry(args.key, {
    kind: "reversible",
    key: args.key,
    message: args.message,
    windowMs,
    timer,
    onUndo: args.onUndo,
  });
  toast.success(args.message, {
    id: args.key,
    duration: windowMs,
    action: { label: "בטל", onClick: () => undoKey(args.key) },
  });
}

export function undoKey(key: string): boolean {
  const entry = pending.get(key);
  if (!entry) return false;
  clearTimeout(entry.timer);
  finish(key);
  toast.dismiss(key);
  if (entry.kind === "deferred") entry.onRevert();
  else void entry.onUndo();
  notify();
  toast(`${entry.message} בוטל.`, { duration: 2000 });
  return true;
}

/** Undo the most recently scheduled still-pending action. Used by the global Ctrl+Z listener. */
export function undoLast(): boolean {
  const key = order[order.length - 1];
  return key ? undoKey(key) : false;
}

// ── convenience wrappers — call sites use these, not the primitives above ──

export function scheduleDeferredDelete(args: {
  scope: string;
  id: string;
  message: string;
  windowMs?: number;
  onCommit: () => Promise<ActionResult>;
}) {
  scheduleDeferredAction({
    key: `${args.scope}:delete:${args.id}`,
    message: args.message,
    windowMs: args.windowMs,
    onApplyOptimistic: () => markHidden(args.scope, args.id),
    onRevert: () => unmarkHidden(args.scope, args.id),
    onCommit: args.onCommit,
  });
}

export function scheduleDeferredEdit(args: {
  scope: string;
  id: string;
  message: string;
  windowMs?: number;
  patch: object;
  onCommit: () => Promise<ActionResult>;
}) {
  scheduleDeferredAction({
    key: `${args.scope}:edit:${args.id}`,
    message: args.message,
    windowMs: args.windowMs,
    onApplyOptimistic: () => setPatch(args.scope, args.id, args.patch),
    onRevert: () => clearPatch(args.scope, args.id),
    onCommit: args.onCommit,
  });
}

export function registerReversibleCreate(args: {
  scope: string;
  id: string;
  message: string;
  windowMs?: number;
  onUndo: () => Promise<ActionResult> | void;
}) {
  registerReversibleAction({
    key: `${args.scope}:create:${args.id}`,
    message: args.message,
    windowMs: args.windowMs,
    onUndo: args.onUndo,
  });
}

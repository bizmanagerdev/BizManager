import type { CommonPowerSyncDatabase } from "@powersync/web";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LocalCardKind, LocalCardViewer } from "./dashboard-local";
import type { LocalReader } from "./local-supabase";
import { storeResult } from "./stored-results";

// The device versions' results, kept and kept current — so a page drawn from
// the on-device copy is there the moment it's opened, instead of being worked
// out after the click.
//
// - Each result (a page part for one person and one set of filters) is worked
//   out once and kept in memory. Opening the page again shows it at once.
// - When PowerSync reports changed tables, only the results that read those
//   tables are redone: at once for what's on screen (after a short pause, so a
//   burst of changes is one redo), and in the phone's idle time for the pages
//   kept ready in the background (warmResults — the four pages' usual views).
// - Each table is read from the device database once per change, not once per
//   query (the versioned reader; see loadTable in local-supabase.ts).
// - What's on screen and the background pages are also stored on the device
//   (stored-results.ts), so the next time the app opens they show before the
//   device database is even open.
//
// All of it reads the device's own copy: no request reaches the server.

type DeviceCode = [typeof import("./dashboard-local"), typeof import("./local-supabase")];

let deviceCode: Promise<DeviceCode> | null = null;
/** The device-side code (the loaders and the client stand-in), loaded once. */
export function loadLocalDataCode(): Promise<DeviceCode> {
  deviceCode ??= Promise.all([import("./dashboard-local"), import("./local-supabase")]);
  deviceCode.catch(() => {
    deviceCode = null;
  });
  return deviceCode;
}

export type ResultSpec = { kind: LocalCardKind; viewer: LocalCardViewer; filters?: unknown };

/** JSON with its object keys sorted — the same filters always name the same result. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function resultKey({ kind, viewer, filters }: ResultSpec): string {
  return [viewer.userId, viewer.role, viewer.locale, kind, stableJson(filters ?? null)].join("|");
}

export type ResultListener = {
  /**
   * A new result (`json`: the same, serialised — to compare with a stored
   * copy; `computeMs`: how long the device took to work it out).
   */
  onData: (data: unknown, json: string, computeMs: number) => void;
  /** "no-data": the copy holds nothing yet (the sync rules aren't deployed). */
  onError: (reason: "no-data" | "error", error?: unknown) => void;
};

class NoDataError extends Error {}

type Entry = {
  spec: ResultSpec;
  data: unknown;
  /** `data` serialised: a result that comes out the same isn't handed on again. */
  json: string;
  /** How long the last working-out took (ms). */
  computeMs: number;
  hasData: boolean;
  /** Bumped whenever a table it reads changes; `doneAt` is the count its data reflects. */
  dirty: number;
  doneAt: number;
  running: Promise<void> | null;
  listeners: Set<ResultListener>;
  /** Kept current in the background even with nobody looking (warmResults). */
  background: number;
  /** The tables it reads (LOCAL_CARD_TABLES), known once the code is loaded. */
  tables: string[] | null;
  timer: ReturnType<typeof setTimeout> | null;
  /** When it was last stored on the device, and a store waiting its turn. */
  storedAt: number;
  storeTimer: ReturnType<typeof setTimeout> | null;
};

type Engine = {
  db: CommonPowerSyncDatabase;
  reader: LocalReader;
  versions: Map<string, number>;
  entries: Map<string, Entry>;
  /** Resolves once the change listener is in place (nothing is read before). */
  ready: Promise<void>;
  hasPeople: Promise<boolean> | null;
  idleQueue: Set<Entry>;
  idleScheduled: boolean;
  dispose: () => void;
};

/** How long a result on screen waits after a change before it's redone. */
const ON_SCREEN_DELAY_MS = 300;
/** Kept results for lists nobody is looking at (filters visited earlier). */
const MAX_IDLE_ENTRIES = 60;
/** A result is stored on the device at most this often (it can change every second). */
const STORE_EVERY_MS = 5000;

let engine: Engine | null = null;

function engineFor(db: CommonPowerSyncDatabase): Engine {
  if (engine?.db === db) return engine;
  engine?.dispose();
  const versions = new Map<string, number>();
  const created: Engine = {
    db,
    reader: { getAll: (sql, params) => db.getAll(sql, params), tableVersion: (table) => versions.get(table) ?? 0 },
    versions,
    entries: new Map(),
    ready: Promise.resolve(),
    hasPeople: null,
    idleQueue: new Set(),
    idleScheduled: false,
    dispose: () => {},
  };
  created.ready = loadLocalDataCode().then(([, { LOCAL_TABLES }]) => {
    if (engine !== created) return;
    // Every synced table: the kept copy of a table is only as current as this.
    const tables = [...LOCAL_TABLES];
    created.dispose = db.onChange(
      {
        onChange: (event) =>
          tablesChanged(
            created,
            event.changedTables.map((name) => name.replace(/^ps_data(_local)?__/, ""))
          ),
      },
      { tables, throttleMs: 50 }
    );
  });
  engine = created;
  return created;
}

function tablesChanged(e: Engine, tables: string[]) {
  if (!tables.length) return;
  for (const table of tables) e.versions.set(table, (e.versions.get(table) ?? 0) + 1);
  if (tables.includes("users")) e.hasPeople = null;
  for (const entry of e.entries.values()) {
    if (entry.tables && !entry.tables.some((table) => tables.includes(table))) continue;
    entry.dirty += 1;
    schedule(e, entry);
  }
}

function schedule(e: Engine, entry: Entry) {
  if (entry.listeners.size > 0) {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      entry.timer = null;
      void run(e, entry);
    }, ON_SCREEN_DELAY_MS);
  } else if (entry.background > 0) {
    scheduleIdle(e, entry);
  }
  // Otherwise it stays marked; whoever opens it next gets it redone.
}

function requestIdle(callback: () => void) {
  if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(callback, { timeout: 3000 });
  } else {
    setTimeout(callback, 200);
  }
}

/** Background work, one result at a time, in the phone's idle moments. */
function scheduleIdle(e: Engine, entry: Entry) {
  e.idleQueue.add(entry);
  if (e.idleScheduled) return;
  e.idleScheduled = true;
  requestIdle(() => void drainIdle(e));
}

async function drainIdle(e: Engine) {
  e.idleScheduled = false;
  const next = e.idleQueue.values().next().value as Entry | undefined;
  if (!next) return;
  e.idleQueue.delete(next);
  if (next.dirty !== next.doneAt || !next.hasData) await run(e, next);
  if (e.idleQueue.size && !e.idleScheduled) {
    e.idleScheduled = true;
    requestIdle(() => void drainIdle(e));
  }
}

/** Store what's on screen or kept ready in the background — throttled, in an idle moment. */
function storeLater(entry: Entry) {
  if (entry.storeTimer) return;
  const wait = Math.max(0, entry.storedAt + STORE_EVERY_MS - Date.now());
  entry.storeTimer = setTimeout(() => {
    requestIdle(() => {
      entry.storeTimer = null;
      if (!entry.hasData || (entry.listeners.size === 0 && entry.background === 0)) return;
      entry.storedAt = Date.now();
      storeResult(resultKey(entry.spec), entry.data, entry.json);
    });
  }, wait);
}

function deviceHasPeople(e: Engine): Promise<boolean> {
  e.hasPeople ??= e.db
    .get<{ n: number }>("SELECT count(*) AS n FROM users")
    .then((row) => row.n > 0)
    .catch(() => false)
    .then((yes) => {
      if (!yes) e.hasPeople = null;
      return yes;
    });
  return e.hasPeople;
}

function run(e: Engine, entry: Entry): Promise<void> {
  if (entry.running) return entry.running;
  const target = entry.dirty;
  entry.running = (async () => {
    try {
      await e.ready;
      if (!(await deviceHasPeople(e))) throw new NoDataError("The device copy holds no data yet");
      const [{ computeLocalCard, LOCAL_CARD_TABLES }, { createLocalSupabase }] = await loadLocalDataCode();
      entry.tables ??= LOCAL_CARD_TABLES[entry.spec.kind];
      const started = performance.now();
      const data = await computeLocalCard(createLocalSupabase(e.reader), entry.spec.kind, entry.spec.viewer, entry.spec.filters);
      const computeMs = performance.now() - started;
      const json = JSON.stringify(data);
      entry.doneAt = target;
      // The same as before (a quiet check, a change that didn't touch it):
      // nothing to redraw, nothing to store.
      if (!entry.hasData || json !== entry.json) {
        entry.data = data;
        entry.json = json;
        entry.computeMs = computeMs;
        entry.hasData = true;
        for (const listener of entry.listeners) listener.onData(data, json, computeMs);
        if (entry.listeners.size > 0 || entry.background > 0) storeLater(entry);
      }
    } catch (error) {
      // Not tried again until something changes (or it's opened again).
      entry.doneAt = target;
      const reason = error instanceof NoDataError ? "no-data" : "error";
      for (const listener of entry.listeners) listener.onError(reason, error);
    } finally {
      entry.running = null;
    }
    // Changed again while it was being worked out.
    if (entry.dirty !== entry.doneAt) schedule(e, entry);
  })();
  return entry.running;
}

function entryFor(e: Engine, spec: ResultSpec): Entry {
  const key = resultKey(spec);
  let entry = e.entries.get(key);
  if (entry) {
    // Most recently used last (the trim below drops from the front).
    e.entries.delete(key);
  } else {
    entry = {
      spec,
      data: undefined,
      json: "",
      computeMs: 0,
      hasData: false,
      dirty: 1,
      doneAt: 0,
      running: null,
      listeners: new Set(),
      background: 0,
      tables: null,
      timer: null,
      storedAt: 0,
      storeTimer: null,
    };
  }
  e.entries.set(key, entry);
  let idle = [...e.entries.values()].filter((x) => x.listeners.size === 0 && x.background === 0 && x !== entry).length;
  for (const [k, x] of e.entries) {
    if (idle <= MAX_IDLE_ENTRIES) break;
    if (x.listeners.size === 0 && x.background === 0 && x !== entry) {
      e.entries.delete(k);
      idle -= 1;
    }
  }
  return entry;
}

/**
 * The last result for `key` from this database, if worked out already (for an
 * instant first paint) — never one kept for another database (another person
 * signed in on this device).
 */
export function peekResult(db: CommonPowerSyncDatabase | null, key: string): { data: unknown } | null {
  if (!db || engine?.db !== db) return null;
  const entry = engine.entries.get(key);
  return entry?.hasData ? { data: entry.data } : null;
}

/**
 * Watch one result: the kept one at once (if any), then every new one —
 * worked out now when there's none or it's out of date, and again whenever a
 * table it reads changes. Returns the unsubscribe.
 */
export function watchResult(db: CommonPowerSyncDatabase, spec: ResultSpec, listener: ResultListener): () => void {
  const e = engineFor(db);
  const entry = entryFor(e, spec);
  entry.listeners.add(listener);
  if (entry.hasData) listener.onData(entry.data, entry.json, entry.computeMs);
  if (!entry.hasData || entry.dirty !== entry.doneAt) {
    void run(e, entry);
  } else {
    // Kept and current — still checked once quietly, in an idle moment: a
    // result can age without any table changing ("today", "overdue").
    requestIdle(() => {
      if (!entry.listeners.size) return;
      entry.dirty += 1;
      void run(e, entry);
    });
  }
  return () => {
    entry.listeners.delete(listener);
    if (entry.listeners.size === 0 && entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
      if (entry.background > 0) scheduleIdle(e, entry);
    }
  };
}

/** One result, current: the kept one if nothing it reads has changed since, else worked out now. */
export async function getResult(db: CommonPowerSyncDatabase, spec: ResultSpec): Promise<unknown> {
  const e = engineFor(db);
  const entry = entryFor(e, spec);
  if (!entry.hasData || entry.dirty !== entry.doneAt) await run(e, entry);
  if (!entry.hasData) throw new Error(`${spec.kind} couldn't be worked out on the device`);
  return entry.data;
}

/**
 * Keep these results ready in the background (the pages' usual views): worked
 * out in idle moments, and again whenever what they read changes. Returns the
 * stop.
 */
export function warmResults(db: CommonPowerSyncDatabase, specs: ResultSpec[]): () => void {
  const e = engineFor(db);
  const entries = specs.map((spec) => entryFor(e, spec));
  for (const entry of entries) {
    entry.background += 1;
    if (!entry.hasData || entry.dirty !== entry.doneAt) scheduleIdle(e, entry);
  }
  return () => {
    for (const entry of entries) entry.background -= 1;
  };
}

/** A Supabase-client stand-in over the device copy, sharing the kept tables. */
export async function localClient(db: CommonPowerSyncDatabase): Promise<SupabaseClient> {
  const e = engineFor(db);
  await e.ready;
  const [, { createLocalSupabase }] = await loadLocalDataCode();
  return createLocalSupabase(e.reader);
}

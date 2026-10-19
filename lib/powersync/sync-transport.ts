// Which way this device's copy talks to the sync service: a WebSocket (the
// default), or a plain HTTP stream. An office filter that inspects every secure
// connection broke the WebSocket on the office computer — "Failed to connect
// WebSocket", "No data received on WebSocket in 30000ms", over and over — and
// the copy stopped getting new rows: a new order showed on the phone but not in
// the website's orders list (owner, 2026-10-12). After a few failed connections
// in a row the device tries the other way, and remembers what worked.

export type SyncTransport = "web-socket" | "http";

const KEY = "bizh-sync-transport";
/** How long a device keeps the other way before trying the WebSocket again. */
const REMEMBER_MS = 7 * 24 * 60 * 60 * 1000;
/** Failed connections in a row before switching. The service retries every 5 s. */
export const SWITCH_AFTER_FAILURES = 3;
/** One failure logs two or three lines ("Sync error", "Failed to connect WebSocket"): one count per this window. */
const SAME_FAILURE_MS = 2000;

/**
 * A way remembered before this is forgotten. The office's NetFree blocked the
 * sync address until 2026-10-18, and the devices that switched to the HTTP
 * stream while it was blocked go back to the WebSocket — the main way — now
 * that it's open (owner, 2026-10-18: "moving computers back to the main way of
 * connecting"). One that still can't use it switches again by itself.
 */
export const FORGET_REMEMBERED_BEFORE = Date.parse("2026-10-18T16:00:00Z");

/** The way this device last found working — the WebSocket unless the other way was kept recently. */
export function storedTransport(now = Date.now()): SyncTransport {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return "web-socket";
    const { transport, at } = JSON.parse(raw) as { transport?: SyncTransport; at?: number };
    if (transport === "http" && typeof at === "number" && at >= FORGET_REMEMBERED_BEFORE && now - at < REMEMBER_MS) {
      return "http";
    }
  } catch {
    // No storage, or something unreadable in it: the default.
  }
  return "web-socket";
}

export function rememberTransport(transport: SyncTransport, now = Date.now()) {
  try {
    if (transport === "web-socket") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify({ transport, at: now }));
  } catch {
    // Fine: this session still switches; the next one starts from the default.
  }
}

export type TransportWatch = {
  readonly transport: SyncTransport;
  /** The sync is connected — the count starts over. */
  connected(): void;
  /** A connection failed (from the sync's log or its status). */
  failed(now?: number): void;
  /** Another tab on this device switched: take its way, without reconnecting (they share one connection). */
  adopt(next: SyncTransport): void;
  /** The device was away — asleep, offline, the tab in the background: the count starts over. */
  reset(): void;
};

/**
 * Counts failed connections in a row and switches the way — once a session, so
 * two ways that both fail don't take turns forever. `onSwitch` reconnects.
 *
 * Every tab of the app on a device shares one sync connection (the sync
 * worker), so they share one decision: only the tab `mayDecide` lets — on
 * screen, in front, online — counts failures and switches; the others take
 * its way (`adopt`, from watchStoredTransport). On 2026-10-18 four tabs on the
 * owner's computer switched in the same second, pulling the one connection
 * different ways ("No iteration is active" in Sentry), after failures logged
 * while the computer slept.
 */
export function createTransportWatch(
  initial: SyncTransport,
  onSwitch: (next: SyncTransport) => void,
  mayDecide: () => boolean = () => true
): TransportWatch {
  let transport = initial;
  let failures = 0;
  let lastFailureAt = -Infinity;
  let switched = false;
  const adopt = (next: SyncTransport) => {
    if (next === transport) return;
    transport = next;
    failures = 0;
    switched = true;
  };
  return {
    get transport() {
      return transport;
    },
    connected() {
      failures = 0;
    },
    failed(now = Date.now()) {
      if (!mayDecide()) return;
      if (now - lastFailureAt < SAME_FAILURE_MS) return;
      lastFailureAt = now;
      failures += 1;
      if (switched || failures < SWITCH_AFTER_FAILURES) return;
      switched = true;
      failures = 0;
      transport = transport === "web-socket" ? "http" : "web-socket";
      rememberTransport(transport, now);
      onSwitch(transport);
    },
    adopt,
    reset() {
      failures = 0;
      lastFailureAt = -Infinity;
    },
  };
}

/** Tell `onChange` whenever another tab on this device switches the way. Returns a stop function. */
export function watchStoredTransport(onChange: (transport: SyncTransport) => void): () => void {
  if (typeof window === "undefined") return () => {};
  // `storage` fires only in the OTHER tabs — the one that switched has already acted.
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) onChange(storedTransport());
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

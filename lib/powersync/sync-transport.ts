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

/** The way this device last found working — the WebSocket unless the other way was kept recently. */
export function storedTransport(now = Date.now()): SyncTransport {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return "web-socket";
    const { transport, at } = JSON.parse(raw) as { transport?: SyncTransport; at?: number };
    if (transport === "http" && typeof at === "number" && now - at < REMEMBER_MS) return "http";
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
};

/**
 * Counts failed connections in a row and switches the way — once a session, so
 * two ways that both fail don't take turns forever. `onSwitch` reconnects.
 */
export function createTransportWatch(
  initial: SyncTransport,
  onSwitch: (next: SyncTransport) => void
): TransportWatch {
  let transport = initial;
  let failures = 0;
  let lastFailureAt = -Infinity;
  let switched = false;
  return {
    get transport() {
      return transport;
    },
    connected() {
      failures = 0;
    },
    failed(now = Date.now()) {
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
  };
}

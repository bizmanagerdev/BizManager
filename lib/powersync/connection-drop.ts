// Which of the sync service's own error reports are a dropped connection rather
// than a bug. The copy reconnects by itself after each of these — a socket that
// closed, nothing received for 30 seconds, a sign-in token that expired while
// the phone slept — so they go to Sentry as warnings: it emails the owner about
// every new ERROR, and these were five of the week's emails (2026-10-11).
//
// "Sync error" with nothing after it is the sync loop reporting the same drop;
// its reason doesn't survive the trip out of the sync worker.

// Narrow on purpose: a database "statement timeout", a refused save or the sync
// service refusing a device's copy (PSYNC_S2305 "too many parameter query
// results", S2404) is a real failure and stays an error.
// The HTTP stream cut mid-download reads "network error" (Chrome) or "Load
// failed" (Safari), and the sync loop then reports "Remote peer closed with
// request in flight"; a WebSocket that went quiet, "No keep-alive acks" — the
// same drops, and most of the week's error-level events (2026-10-27).
const DROP =
  /socket closed|websocket|connection closed|failed to fetch|networkerror|network error|load failed|remote peer closed|keep-alive acks|PSYNC_S2103|jwt has expired/i;

// The sync service's own error codes, which can arrive wrapped in a WebSocket's
// error text: any but an expired sign-in (S2103) is the service refusing this
// device — נתן's phone's "too many parameter query results" sat for a day
// among the dropped-connection warnings (Sentry, 2026-10-26).
const SERVICE_REFUSED = /PSYNC_S(?!2103)\d{4}/i;

export function isConnectionDrop(message: string, description: string): boolean {
  if (message === "Sync error" && description.trim() === "") return true;
  const text = `${message} ${description}`;
  if (SERVICE_REFUSED.test(text)) return false;
  return DROP.test(text);
}

// Which of the sync service's own error reports are a dropped connection rather
// than a bug. The copy reconnects by itself after each of these — a socket that
// closed, nothing received for 30 seconds, a sign-in token that expired while
// the phone slept — so they go to Sentry as warnings: it emails the owner about
// every new ERROR, and these were five of the week's emails (2026-10-11).
//
// "Sync error" with nothing after it is the sync loop reporting the same drop;
// its reason doesn't survive the trip out of the sync worker.

// Narrow on purpose: a database "statement timeout" or a refused save is a real
// failure and stays an error.
const DROP = /socket closed|websocket|connection closed|failed to fetch|networkerror|PSYNC_S2103|jwt has expired/i;

export function isConnectionDrop(message: string, description: string): boolean {
  if (message === "Sync error" && description.trim() === "") return true;
  return DROP.test(`${message} ${description}`);
}

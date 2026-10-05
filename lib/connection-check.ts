// TEMPORARY (2026-10-05) — the connection check (/connection-check). Whether
// THIS device has finished it: the dashboard asks everyone to run it once per
// device (the Android app, the installed web app and a phone's browser can sit
// behind different filters), and stops asking once it's done here.

const DONE_KEY = "bizh-connection-check-done";
const DONE_EVENT = "bizh-connection-check-done";

export function markConnectionCheckDone(): void {
  try {
    localStorage.setItem(DONE_KEY, String(Date.now()));
  } catch {
    // Storage blocked: the card just keeps asking on this device.
  }
  window.dispatchEvent(new Event(DONE_EVENT));
}

export function hasDoneConnectionCheck(): boolean {
  try {
    return Boolean(localStorage.getItem(DONE_KEY));
  } catch {
    return false;
  }
}

/** For useSyncExternalStore: this tab finishing it, or another tab. */
export function subscribeConnectionCheckDone(onChange: () => void): () => void {
  window.addEventListener(DONE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(DONE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

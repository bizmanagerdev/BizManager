import { withSentry } from "@/lib/sentry-lazy";
import { isServerReachable } from "@/lib/pwa/connection";

// What went wrong with no connection, kept on the device and sent to Sentry
// once the connection is back. A report sent offline is lost — and the moments
// with no connection are exactly the ones the offline work needs to see (owner's
// offline test, 2026-10-25: a page not saved, a page that failed, and nothing
// about either in Sentry). Sent by components/pwa/PwaRegistration.

const REPORT_KEY = "bizh-offline-report";
const MAX_NOTES = 20;

export type OfflineNote = { what: string; at: string; page: string } & Record<string, unknown>;

function readNotes(): OfflineNote[] {
  try {
    const notes = JSON.parse(localStorage.getItem(REPORT_KEY) ?? "[]") as unknown;
    return Array.isArray(notes) ? (notes as OfflineNote[]) : [];
  } catch {
    return [];
  }
}

/** Keep a note of something that went wrong offline (the last MAX_NOTES). */
export function noteOffline(what: string, detail: Record<string, unknown> = {}): void {
  try {
    const note: OfflineNote = { what, at: new Date().toISOString(), page: window.location.pathname, ...detail };
    localStorage.setItem(REPORT_KEY, JSON.stringify([...readNotes(), note].slice(-MAX_NOTES)));
  } catch {
    // Storage blocked or full: the note is lost, as it would have been.
  }
}

/** The pages saved on this device (the service worker's frames and whole-page copies), for a note. */
export async function savedPagesNow(): Promise<{ frames: string[]; pages: string[] }> {
  const frames: string[] = [];
  const pages: string[] = [];
  try {
    for (const name of await caches.keys()) {
      const into = name.startsWith("bizh-frames-") ? frames : name.startsWith("bizh-pages-") ? pages : null;
      if (!into) continue;
      // Which version saved it: the cache's name ends with its build.
      const version = name.replace(/^bizh-(frames|pages)-/, "").slice(0, 8);
      for (const request of await (await caches.open(name)).keys()) {
        const url = new URL(request.url);
        // A page's data requests (?_rsc=) aren't pages.
        if (url.searchParams.has("_rsc")) continue;
        into.push(`${version} ${url.pathname}${url.search}`);
      }
    }
  } catch {
    // No Cache Storage here: nothing saved.
  }
  return { frames: frames.slice(0, 80), pages: pages.slice(0, 40) };
}

/** Send the notes kept offline (one report), once there's a connection. */
export function sendOfflineReport(): void {
  // Only once the server answers (lib/pwa/connection.ts — the device's own
  // word isn't enough); and not from a saved copy on screen: sent from the
  // page that loads once the server does.
  if (!isServerReachable() || document.documentElement.dataset.bizhSaved !== undefined) return;
  const notes = readNotes();
  if (notes.length === 0) return;
  try {
    localStorage.removeItem(REPORT_KEY);
  } catch {
    return; // Can't clear them: don't send the same ones over and over.
  }
  withSentry((Sentry) =>
    Sentry.captureMessage(`Offline report: ${notes.map((note) => note.what).join(", ")}`.slice(0, 200), {
      level: "warning",
      tags: { area: "offline" },
      fingerprint: ["offline-report"],
      extra: { notes },
    })
  );
}

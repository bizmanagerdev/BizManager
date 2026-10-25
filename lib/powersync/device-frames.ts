import { localDataPageOn, type LOCAL_DATA_PAGES } from "./config";
import type { SectionAccess } from "@/lib/auth/sections";

// The device pages' frames the service worker saves (public/sw.js,
// FRAMES_CACHE) so the app opens on them at once. They show the signed-in
// person's layout, so they go at logout and when someone else signs in.

const FRAMES_PREFIX = "bizh-frames-";
const FRAMES_USER_KEY = "bizh-frames-user";

export async function clearDeviceFrames(): Promise<void> {
  try {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith(FRAMES_PREFIX)).map((name) => caches.delete(name)));
  } catch {
    // No Cache Storage here (or blocked): nothing was saved.
  }
}

/**
 * Drop the saved frames of one page (any of its filters), so loading it again
 * reaches the server — a reload onto a newer version. The other pages' frames
 * stay: they're what opens with no connection.
 */
export async function dropDeviceFrame(href: string): Promise<void> {
  try {
    const names = (await caches.keys()).filter((name) => name.startsWith(FRAMES_PREFIX));
    await Promise.all(names.map(async (name) => (await caches.open(name)).delete(href, { ignoreSearch: true })));
  } catch {
    // No Cache Storage here (or blocked): nothing was saved.
  }
}

/** Someone other than the frames' person is signed in on this device: drop them. */
export function keepDeviceFramesFor(userId: string): void {
  try {
    if (localStorage.getItem(FRAMES_USER_KEY) === userId) return;
    localStorage.setItem(FRAMES_USER_KEY, userId);
  } catch {
    // Storage blocked: clear, to be safe.
  }
  void clearDeviceFrames();
}

/**
 * Ask the service worker to save these pages' frames in the background, each
 * one it hasn't saved yet (public/sw.js, SAVE_FRAMES). A page reached by
 * moving inside the app is never loaded whole, so this is the only way it's
 * saved — and opens with no connection (owner's offline test, 2026-10-24).
 */
export function saveDeviceFrames(hrefs: string[]): void {
  try {
    const worker = navigator.serviceWorker?.controller;
    if (!worker || !navigator.onLine || hrefs.length === 0) return;
    worker.postMessage({ type: "SAVE_FRAMES", urls: hrefs });
  } catch {
    // No service worker here: nothing is saved anyway.
  }
}

/** The menu's pages that have a device version, and their addresses. */
const MENU_FRAME_PAGES: { page: keyof typeof LOCAL_DATA_PAGES; path: string; workerSection?: keyof SectionAccess }[] = [
  { page: "dashboard", path: "/dashboard", workerSection: "dashboard" },
  { page: "tasks", path: "/tasks", workerSection: "tasks" },
  { page: "projects", path: "/projects" },
  { page: "sales", path: "/sales" },
  { page: "customers", path: "/customers" },
  { page: "properties", path: "/properties" },
  { page: "rentRoll", path: "/rent" },
  // The drivers' page: in workers' menu only (the office has the sales page's tab).
  { page: "deliveries", path: "/deliveries", workerSection: "deliveries" },
];

/** The menu pages drawn from the device for this person — the ones saved after each update (OfflineMenuFrames). */
export function menuFramePaths(
  viewer: { id: string; role: string | null | undefined; locale?: string | null },
  access?: SectionAccess
): string[] {
  const worker = viewer.role === "worker";
  return MENU_FRAME_PAGES.filter(({ page, workerSection }) => {
    if (!localDataPageOn(page, viewer)) return false;
    if (page === "deliveries" && !worker) return false;
    return !worker || (workerSection !== undefined && access?.[workerSection] !== false);
  }).map(({ path }) => path);
}

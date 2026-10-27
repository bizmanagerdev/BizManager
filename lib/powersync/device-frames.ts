import { localDataPageOn, type LOCAL_DATA_PAGES } from "./config";
import type { SectionAccess } from "@/lib/auth/sections";
import { isServerReachable } from "@/lib/pwa/connection";
import { RUNNING_BUILD } from "@/lib/pwa/app-version";

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
    if (!worker || !isServerReachable() || hrefs.length === 0) return;
    worker.postMessage({ type: "SAVE_FRAMES", urls: hrefs });
  } catch {
    // No service worker here: nothing is saved anyway.
  }
}

/**
 * Ask the service worker to download the whole app's code for this version
 * (public/sw.js, SAVE_APP_CODE), so every screen, form and dialog works with
 * no connection (owner, 2026-10-27: "let's just do the whole app at once").
 * The deployment this page came from (its files' ?dpl=) goes with it, so the
 * code comes from this version even once a newer one is live.
 */
export function saveAppCode(): void {
  try {
    const worker = navigator.serviceWorker?.controller;
    if (!worker || !isServerReachable()) return;
    const src = document.querySelector<HTMLScriptElement>('script[src*="dpl="]')?.src;
    const dpl = src ? (new URL(src).searchParams.get("dpl") ?? "") : "";
    worker.postMessage({ type: "SAVE_APP_CODE", build: RUNNING_BUILD, dpl });
  } catch {
    // No service worker here: nothing is saved anyway.
  }
}

/** The menu's pages that have a device version, and their addresses. */
const MENU_FRAME_PAGES: {
  page: keyof typeof LOCAL_DATA_PAGES;
  path: string;
  workerSection?: keyof SectionAccess;
  adminOnly?: true;
}[] = [
  { page: "dashboard", path: "/dashboard", workerSection: "dashboard" },
  { page: "tasks", path: "/tasks", workerSection: "tasks" },
  { page: "projects", path: "/projects" },
  { page: "sales", path: "/sales" },
  { page: "customers", path: "/customers" },
  { page: "properties", path: "/properties" },
  { page: "rentRoll", path: "/rent" },
  { page: "bank", path: "/financial/bank", adminOnly: true },
  // The drivers' page: in workers' menu only (the office has the sales page's tab).
  { page: "deliveries", path: "/deliveries", workerSection: "deliveries" },
];

/** The menu pages drawn from the device for this person — the ones saved after each update (OfflineMenuFrames). */
export function menuFramePaths(
  viewer: { id: string; role: string | null | undefined; locale?: string | null },
  access?: SectionAccess
): string[] {
  const worker = viewer.role === "worker";
  return MENU_FRAME_PAGES.filter(({ page, workerSection, adminOnly }) => {
    if (!localDataPageOn(page, viewer)) return false;
    if (adminOnly && viewer.role !== "admin") return false;
    if (page === "deliveries" && !worker) return false;
    return !worker || (workerSection !== undefined && access?.[workerSection] !== false);
  }).map(({ path }) => path);
}

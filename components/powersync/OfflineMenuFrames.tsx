"use client";

import { useEffect } from "react";
import { useLocalSyncStatus, useSyncBlocked } from "@/lib/powersync/store";
import { menuFramePaths, saveAppCode, saveDeviceFrames } from "@/lib/powersync/device-frames";
import { isServerReachable, whenServerReachable } from "@/lib/pwa/connection";
import type { LocalCardViewer } from "@/lib/powersync/dashboard-local";
import type { SectionAccess } from "@/lib/auth/sections";

/** After the page has settled: never competing with the opening itself. */
const AFTER_OPENING_MS = 8000;
const DONE_KEY = "bizh-menu-frames";
/**
 * With no ready copy, the app's code is asked for this long after the app
 * opened — never competing with a first download of the copy.
 */
const CODE_WITHOUT_COPY_MS = 3 * 60 * 1000;
const CODE_DONE_KEY = "bizh-app-code";

/** True the first time this tab asks for `key` under this service worker version. */
function firstAskThisVersion(key: string, version: string): boolean {
  try {
    if (sessionStorage.getItem(key) === version) return false;
    sessionStorage.setItem(key, version);
  } catch {
    // No session storage: asked once per page load instead.
  }
  return true;
}

/**
 * Renders nothing. Asks the service worker to save the menu's device pages
 * (lib/powersync/device-frames.ts menuFramePaths) — each one it hasn't saved
 * since the last update — so the menu opens with no connection even on a
 * page not opened since (owner, 2026-10-24: "do all 3") — and the whole
 * app's code (owner, 2026-10-27: "let's just do the whole app at once").
 * Each once per tab per service worker version.
 *
 * The pages only while the device's copy is complete and syncing: otherwise
 * the server sends their server version, which isn't saved, and the requests
 * would be for nothing. The code needs no copy: with one ready it comes with
 * the pages; without — a new device still downloading it, a sync refused or
 * blocked by the network — CODE_WITHOUT_COPY_MS after the app opened (owner,
 * 2026-10-27: "or a few minutes after the app opens if it hasn't"). Before,
 * such a device never got it, and a form never opened couldn't open offline.
 */
export default function OfflineMenuFrames({ viewer, access }: { viewer: LocalCardViewer; access?: SectionAccess }) {
  const status = useLocalSyncStatus();
  const blocked = useSyncBlocked();
  const ready = Boolean(status?.hasSynced) && !blocked;
  // A string, so a new but equal `access` on every render doesn't start the wait over.
  const pathsKey = menuFramePaths({ id: viewer.userId, role: viewer.role, locale: viewer.locale }, access).join(" ");

  useEffect(() => {
    if (!ready || !pathsKey || !("serviceWorker" in navigator)) return;
    const paths = pathsKey.split(" ");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = () => {
      const version = navigator.serviceWorker.controller?.scriptURL;
      if (!version || !isServerReachable()) return;
      if (firstAskThisVersion(DONE_KEY, version)) saveDeviceFrames(paths);
    };
    const later = () => {
      clearTimeout(timer);
      timer = setTimeout(ask, AFTER_OPENING_MS);
    };
    later();
    // A new version took over: its saved pages are only those of its own build.
    navigator.serviceWorker.addEventListener("controllerchange", later);
    return () => {
      clearTimeout(timer);
      navigator.serviceWorker.removeEventListener("controllerchange", later);
    };
  }, [ready, pathsKey]);

  // The whole app's code (public/sw.js, SAVE_APP_CODE) — whoever has menu
  // pages to save or not (a worker reading Arabic has none). Counted from the
  // app's opening, not this page's: moving inside the app doesn't start it over.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopWaiting: (() => void) | undefined;
    const ask = () => {
      stopWaiting?.();
      stopWaiting = whenServerReachable(() => {
        const version = navigator.serviceWorker.controller?.scriptURL;
        if (version && firstAskThisVersion(CODE_DONE_KEY, version)) saveAppCode();
      });
    };
    const later = () => {
      clearTimeout(timer);
      const wait = ready
        ? AFTER_OPENING_MS
        : Math.max(AFTER_OPENING_MS, performance.timeOrigin + CODE_WITHOUT_COPY_MS - Date.now());
      timer = setTimeout(ask, wait);
    };
    later();
    // A new version took over: its code is another list.
    navigator.serviceWorker.addEventListener("controllerchange", later);
    return () => {
      clearTimeout(timer);
      stopWaiting?.();
      navigator.serviceWorker.removeEventListener("controllerchange", later);
    };
  }, [ready]);

  return null;
}

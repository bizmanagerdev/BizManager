"use client";

import { useEffect } from "react";
import { useLocalSyncStatus, useSyncBlocked } from "@/lib/powersync/store";
import { menuFramePaths, saveDeviceFrames } from "@/lib/powersync/device-frames";
import type { LocalCardViewer } from "@/lib/powersync/dashboard-local";
import type { SectionAccess } from "@/lib/auth/sections";

/** After the page has settled: never competing with the opening itself. */
const AFTER_OPENING_MS = 8000;
const DONE_KEY = "bizh-menu-frames";

/**
 * Renders nothing. Asks the service worker to save the menu's device pages
 * (lib/powersync/device-frames.ts menuFramePaths) — each one it hasn't saved
 * since the last update — so the menu opens with no connection even on a
 * page not opened since (owner, 2026-10-24: "do all 3"). Once per tab per
 * service worker version, and only while the device's copy is complete and
 * syncing: otherwise the server sends the pages' server version, which isn't
 * saved, and the requests would be for nothing.
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
      if (!version || !navigator.onLine) return;
      try {
        if (sessionStorage.getItem(DONE_KEY) === version) return;
        sessionStorage.setItem(DONE_KEY, version);
      } catch {
        // No session storage: asked once per page load instead.
      }
      saveDeviceFrames(paths);
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

  return null;
}

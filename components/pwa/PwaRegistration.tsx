"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { processQueue } from "@/lib/offline-queue";
import { processUploadQueue } from "@/lib/offline-upload";

// A resumed PWA/installed-app instance (tapping the home-screen icon, not a
// real relaunch) does NOT re-run this component's mount effect — it never
// re-checks for a newer service worker, and Server Components (profile,
// locale, section_access, roles...) never re-fetch either, so the app can
// sit on whatever it last rendered indefinitely. Confirmed live 2026-09-10:
// a worker's admin-set locale was correct in the DB the whole time, but his
// installed app kept rendering an old snapshot from around account creation
// with no way for it to notice the server had moved on. RESUME_REVALIDATE_MS
// bounds how long that staleness can persist before the next foreground
// re-checks both the SW build and re-runs Server Components via
// router.refresh() (soft — keeps client state, unlike a full reload).
const RESUME_REVALIDATE_MS = 5 * 60 * 1000;

export default function PwaRegistration() {
  const router = useRouter();
  const [, startTransition] = useTransition();
  // 0, not Date.now() — seeding a ref from an impure call during render trips
  // react-hooks/purity. Set to the real timestamp inside the effect instead,
  // which runs after render.
  const lastRevalidatedAtRef = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    if (lastRevalidatedAtRef.current === 0) lastRevalidatedAtRef.current = Date.now();

    // In development the SW caches stale Next.js dev chunks and HTML, which
    // causes chronic hydration mismatches because the page was already
    // intercepted by the SW BEFORE this cleanup code can run. So: unregister,
    // wipe all caches, and force a one-time reload so the NEXT page load
    // bypasses the SW entirely.
    if (process.env.NODE_ENV !== "production") {
      void (async () => {
        const regs = await navigator.serviceWorker.getRegistrations();
        const hadSw = regs.length > 0;
        await Promise.all(regs.map((reg) => reg.unregister()));
        if (typeof caches !== "undefined") {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        }
        // If we just unregistered an SW, the current page was likely served
        // from its cache. Force one reload so future loads come from network.
        if (hadSw && !sessionStorage.getItem("__sw_killed__")) {
          sessionStorage.setItem("__sw_killed__", "1");
          window.location.reload();
        }
      })();
      return;
    }

    // Version the script URL with the build id so every deploy is a distinct
    // service worker: the browser installs it, activate() purges the previous
    // build's caches, and the controllerchange handler below reloads once onto
    // the fresh bundle. A constant "/sw.js" URL let stale caches live forever.
    const swUrl = `/sw.js?v=${encodeURIComponent(process.env.NEXT_PUBLIC_BUILD_ID ?? "v13")}`;

    const registration = navigator.serviceWorker.register(swUrl).then((reg) => {
      // Proactively check for a newer service worker on each load (don't wait for the
      // browser's periodic check) so a fixed build / cache-version bump is picked up fast.
      void reg.update().catch(() => {});
      return reg;
    });

    // Self-heal stale caches: when an UPDATED service worker takes control (it purges old
    // caches on activate), reload once so the page runs the fresh build instead of stale
    // chunks — e.g. a device stuck on an old bundle recovers with no manual cache clearing.
    // Guarded against reload loops; skips the first install (no prior controller) so new
    // visitors don't double-load.
    const hadController = Boolean(navigator.serviceWorker.controller);
    const onControllerChange = () => {
      if (!hadController) return;
      if (sessionStorage.getItem("__sw_reloaded__")) return;
      sessionStorage.setItem("__sw_reloaded__", "1");
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    // Listen for the SW telling us to drain the queue (Background Sync fallback path)
    const handleMessage = (event: MessageEvent) => {
      if ((event.data as { type?: string })?.type === "PROCESS_OFFLINE_QUEUE") {
        void processQueue();
        void processUploadQueue();
      }
    };
    navigator.serviceWorker.addEventListener("message", handleMessage);

    // Re-validate when the app comes back to the foreground after sitting
    // backgrounded — a resumed instance otherwise never re-checks anything
    // (see RESUME_REVALIDATE_MS above). Checks the SW build AND re-runs
    // Server Components (router.refresh, soft — no visible reload) so
    // session-derived data that can change server-side at any time (locale,
    // role, section_access, active/system_access) can't go stale for longer
    // than the threshold. Time-gated, not every tab-switch, to avoid
    // refreshing on a quick glance at another app.
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastRevalidatedAtRef.current < RESUME_REVALIDATE_MS) return;
      lastRevalidatedAtRef.current = now;
      void registration.then((reg) => reg.update().catch(() => {}));
      startTransition(() => {
        router.refresh();
      });
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    // Register a Background Sync tag so the SW can wake us up when online
    const registerSync = async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        if ("sync" in reg) {
          await (reg as ServiceWorkerRegistration & { sync: { register(tag: string): Promise<void> } }).sync.register(
            "process-offline-queue"
          );
        }
      } catch {
        // Background Sync not supported (e.g. Safari) — online event handles it instead
      }
    };
    void registerSync();

    return () => {
      navigator.serviceWorker.removeEventListener("message", handleMessage);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [router, startTransition]);

  return null;
}


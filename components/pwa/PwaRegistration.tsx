"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { processQueue } from "@/lib/offline-queue";
import { processUploadQueue } from "@/lib/offline-upload";
import { dropDeviceFrame } from "@/lib/powersync/device-frames";
import { RUNNING_BUILD, isNewerBuild, liveBuild, mayReloadFrom, noteReloadFrom, swBuildOf } from "@/lib/pwa/app-version";

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

// Moving inside the app to a page with no saved copy, with no connection: the
// service worker keeps this page on screen and says which page it was
// (public/sw.js, tellNotSaved). Next.js gave up on the move by then and waits
// for a whole-page load that isn't coming — the same address in the history
// again settles it, so the page carries on (owner, 2026-10-24: "the whole app
// basically crashed").
const SETTLE_AFTER_MS = 300;
let settleTimer: ReturnType<typeof setTimeout> | undefined;

function pageNotSaved(href: unknown) {
  if (typeof href !== "string" || document.visibilityState !== "visible") return;
  let target: URL;
  try {
    target = new URL(href, window.location.href);
  } catch {
    return;
  }
  // The page on screen itself (refreshed): nothing moved.
  if (target.pathname + target.search === window.location.pathname + window.location.search) return;
  toast.info("הדף הזה לא שמור במכשיר — ייפתח כשיחזור החיבור", { id: "page-not-saved" });
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => window.history.replaceState(null, "", window.location.href), SETTLE_AFTER_MS);
}

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
    //
    // Also skipped for e2e (NEXT_PUBLIC_E2E_TEST, baked in at build time by
    // .github/workflows/ci.yml's "Build the app" step): CI now tests a real
    // production build served from 127.0.0.1, which is exactly the hostname
    // sw.js's own IS_DEV_HOST guard treats as a developer's stray localhost
    // session — it self-destructs AND force-navigates every open tab the
    // moment it activates, mid-test. That's the right call for a real dev
    // machine, but there's nothing stale about a fresh e2e build; this only
    // stops the SW from registering at all so its dev-host cleanup never has
    // a reason to fire. Root-caused after switching CI off `next dev` (see
    // playwright.config.ts's webServer comment) didn't fix the SAME "element
    // detached from the DOM" instability — proof it was never really about
    // dev-mode compilation, at least not only.
    if (process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_E2E_TEST === "1") {
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
    //
    // Never in the middle of use (owner, 2026-10-07: switching fast between pages, the app
    // "jumps back as if it just loaded" — the new version arrives a few seconds after the
    // app opens, and a reload then lands on whatever page the address still names, often
    // the one being left). Only while the app is in the background: at once if it already
    // is, else the next time it goes there. Meanwhile the running version keeps working:
    // Vercel's Skew Protection answers its page moves and refreshes from its own
    // deployment, and the new version arrives on the next opening — its page saved and
    // its code fetched in the background by the service worker (public/sw.js).
    //
    // And a newer version found by asking the server (owner, 2026-10-20: the phone app
    // stayed on 10-17's version for days — Android kept it alive, so it was only ever
    // resumed, and nothing told the running page a new one existed). Each time the app
    // comes back to the screen (and once when it opens) it asks which build the server
    // runs (lib/pwa/app-version.ts); a newer one is loaded the same way — the next time
    // the app is left. Before that reload this page's saved copy goes (it is this old
    // build's page, and the service worker would answer the reload with it), so it lands
    // on the new version. The other pages' copies stay: they're what opens with no
    // connection, and the new version saves its own (2026-10-24 — every update used to
    // wipe them all, in every open tab).
    const hadController = Boolean(navigator.serviceWorker.controller);
    let reloadWhenHidden = false;
    // Once per build (a reload that lands on the same build again doesn't loop), and
    // again after a while — not once per session: a session that never ends never
    // updated again (lib/pwa/app-version.ts mayReloadFrom).
    const reloadOntoNewVersion = async () => {
      if (!mayReloadFrom()) return;
      noteReloadFrom();
      await dropDeviceFrame(window.location.href);
      window.location.reload();
    };
    const reloadWhenLeft = () => {
      if (document.visibilityState === "hidden") void reloadOntoNewVersion();
      else reloadWhenHidden = true;
    };
    const onControllerChange = () => {
      if (!hadController) return;
      // The worker that took over is this page's own build: nothing newer to load.
      if (swBuildOf((navigator.serviceWorker.controller as ServiceWorker | null)?.scriptURL) === RUNNING_BUILD) return;
      reloadWhenLeft();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    const checkForNewVersion = () => {
      void liveBuild().then((live) => {
        if (isNewerBuild(live)) reloadWhenLeft();
      });
    };
    checkForNewVersion();

    // Listen for the SW telling us to drain the queue (Background Sync fallback path),
    // or that a page moved to with no connection isn't saved (pageNotSaved above).
    const handleMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; url?: unknown } | null;
      if (data?.type === "PROCESS_OFFLINE_QUEUE") {
        void processQueue();
        void processUploadQueue();
      } else if (data?.type === "PAGE_NOT_SAVED") {
        pageNotSaved(data.url);
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
      if (document.visibilityState === "hidden" && reloadWhenHidden) {
        reloadWhenHidden = false;
        void reloadOntoNewVersion();
        return;
      }
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastRevalidatedAtRef.current < RESUME_REVALIDATE_MS) return;
      lastRevalidatedAtRef.current = now;
      void registration.then((reg) => reg.update().catch(() => {}));
      checkForNewVersion();
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


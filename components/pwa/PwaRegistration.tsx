"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { processQueue } from "@/lib/offline-queue";
import { processUploadQueue } from "@/lib/offline-upload";
import { dropDeviceFrame } from "@/lib/powersync/device-frames";
import { emitNavigationContentShown } from "@/components/layout/TopNavigationProgress";
import { noteOffline, savedPagesNow, sendOfflineReport } from "@/lib/pwa/offline-report";
import { isServerReachable, useServerReachable, watchConnection } from "@/lib/pwa/connection";
import { markPageNotOnDevice, pageNotOnDevice } from "@/lib/pwa/page-not-on-device";
import { OPENS_HERE_ATTRIBUTE } from "@/lib/tasks/open-task-here";
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
// page opens anyway and says in its place that its data isn't on the device
// (OfflinePageGate) — the menu and the red bar stay, the next page a tap away
// (owner, 2026-10-28: "Spotify style"; staying put with a notice, the way since
// 2026-10-24, was "more frustrating than coming to that page and seeing it
// offline").
//
// With no connection a tap asks the service worker first whether the page
// opens from the device (public/sw.js, CAN_OPEN_OFFLINE): yes — the move goes
// on as usual; no — the app opens it as not on the device itself, and Next.js
// never starts a move it can't finish. Started anyway, that move ends in a
// whole-page load the service worker answers with nothing (a 204): Next.js
// 16.4 then waited on it for good, and putting the page's address in the
// history froze the page (the offline e2e test, 2026-10-28).
/** How long a tap waits for the service worker's answer before moving as usual. */
const ASK_TIMEOUT_MS = 1500;
const SETTLE_AFTER_MS = 300;
let settleTimer: ReturnType<typeof setTimeout> | undefined;

/** The app's router, for a move a tap held back (set by PwaRegistration). */
let appRouter: { push: (href: string) => void } | null = null;

function addressOf(url: { pathname: string; search: string }): string {
  return url.pathname + url.search;
}

/** Does this page open from the device? The service worker's own answer — not sure: yes. */
function canOpenOffline(href: string): Promise<boolean> {
  const worker = navigator.serviceWorker?.controller;
  if (!worker) return Promise.resolve(true);
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(true), ASK_TIMEOUT_MS);
    channel.port1.onmessage = (event: MessageEvent) => {
      clearTimeout(timer);
      resolve((event.data as { saved?: boolean } | null)?.saved !== false);
    };
    worker.postMessage({ type: "CAN_OPEN_OFFLINE", url: href }, [channel.port2]);
  });
}

/** What the device had saved when a page wasn't, for the report sent once the connection is back (lib/pwa/offline-report.ts). */
function noteNotSaved(address: string) {
  void savedPagesNow().then((saved) =>
    noteOffline("page not saved", {
      url: address,
      worker: navigator.serviceWorker?.controller?.scriptURL ?? null,
      // As text: Sentry cuts lists this deep to "[Array]" (the first report, 2026-10-27).
      frames: saved.frames.join(" · "),
      pages: saved.pages.join(" · "),
    })
  );
}

/** Opens `address` as not on the device: its address, with the word in its place (OfflinePageGate). */
function openNotOnDevice(address: string) {
  markPageNotOnDevice(address);
  // The loading bar started with the tap: there's nothing to wait for.
  emitNavigationContentShown();
  window.history.pushState(null, "", address);
  noteNotSaved(address);
}

/** A tap on a link inside the app — capture phase, before Next.js moves. */
function onAppTap(event: MouseEvent) {
  const anchor = (event.target as Element | null)?.closest?.("a");
  if (!anchor?.href || (anchor.target && anchor.target !== "_self")) return;
  let to: URL;
  try {
    to = new URL(anchor.href);
  } catch {
    return;
  }
  const address = addressOf(to);
  if (to.origin !== window.location.origin || address === addressOf(window.location)) return;
  // On to another page: the one that wasn't on the device is left behind.
  if (pageNotOnDevice() !== address) markPageNotOnDevice(null);
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return;
  }
  // Not a move: a download, or a task row that opens its task right here.
  if (anchor.hasAttribute("download") || anchor.hasAttribute(OPENS_HERE_ATTRIBUTE)) return;
  if (isServerReachable() || !navigator.serviceWorker?.controller) return;
  // Held until the service worker answers — a link skips a tap already prevented.
  event.preventDefault();
  void canOpenOffline(to.href).then((opens) => {
    if (!opens) openNotOnDevice(address);
    else if (appRouter) appRouter.push(address);
    else window.location.assign(address);
  });
}

/**
 * The service worker answered a move "not saved" (tellNotSaved) — a tap made
 * before the app knew the connection was gone, or a page changing its own
 * address. Next.js waits for a whole-page load that isn't coming: the same
 * address in the history again settles it, the page on screen staying as it
 * is; the next tap is asked first (onAppTap).
 */
function pageNotSaved(href: unknown) {
  if (typeof href !== "string" || document.visibilityState !== "visible") return;
  let target: URL;
  try {
    target = new URL(href, window.location.href);
  } catch {
    return;
  }
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => window.history.replaceState(null, "", window.location.href), SETTLE_AFTER_MS);
  if (addressOf(target) !== addressOf(window.location)) noteNotSaved(addressOf(target));
}

export default function PwaRegistration() {
  const router = useRouter();
  const [, startTransition] = useTransition();
  // 0, not Date.now() — seeding a ref from an impure call during render trips
  // react-hooks/purity. Set to the real timestamp inside the effect instead,
  // which runs after render.
  const lastRevalidatedAtRef = useRef(0);

  // Whether the server answers — the device's own "online" can't be trusted
  // (lib/pwa/connection.ts). Each time it does again (and when the app opens),
  // what went wrong with no connection is sent (lib/pwa/offline-report.ts).
  useEffect(() => watchConnection(), []);
  // For a move a tap held back with no connection (onAppTap).
  useEffect(() => {
    appRouter = router;
    return () => {
      if (appRouter === router) appRouter = null;
    };
  }, [router]);
  const reachable = useServerReachable();
  useEffect(() => {
    if (reachable) sendOfflineReport();
  }, [reachable]);

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
    //
    // Except on the offline test's own address (a .test name the test's browser
    // maps to 127.0.0.1 — e2e/offline-pages.spec.ts): there the worker is what's
    // being tested, and sw.js runs as it does in production.
    const testBuildWithoutWorker =
      process.env.NEXT_PUBLIC_E2E_TEST === "1" && !window.location.hostname.endsWith(".test");
    if (process.env.NODE_ENV !== "production" || testBuildWithoutWorker) {
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
    window.addEventListener("click", onAppTap, true);

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
      window.removeEventListener("click", onAppTap, true);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [router, startTransition]);

  return null;
}


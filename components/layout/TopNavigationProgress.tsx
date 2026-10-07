"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const NAV_START_EVENT = "app:navigation-start";
const CONTENT_SHOWN_EVENT = "app:navigation-content-shown";
const ACTIVITY_START_EVENT = "app:progress-activity-start";
const ACTIVITY_END_EVENT = "app:progress-activity-end";
const ROUTE_LOADING_SELECTOR = "[data-route-loading='true']";
// After the address changes with no loading screen up, how long to wait for
// one that mounts a moment later before calling the page loaded. Was 700 ms —
// on a page drawn at once (from the phone's copy) the bar then ran on for
// most of a second after the page was there (owner, 2026-10-07). A route's
// loading screen comes in the same frame as the new address (measured on a
// phone-size production build), so this is only a small safety margin.
const SKELETON_APPEAR_WAIT_MS = 50;
// A page move (or save) that's done within this long shows no bar at all: an
// opening drawn at once from the phone's copy, or a page opened before, had a
// bar flash over it that read as "the page, then the bar" (owner, 2026-10-07:
// "when open is instant no bar"). Longer ones get the bar, which then ends the
// moment the page is on screen — no minimum time on screen.
const SHOW_AFTER_MS = 150;
const FAILSAFE_MS = 12000;
// How long the bar takes to fade out after it fills to 100%. Kept short so the
// bar clears the moment content is ready instead of lingering.
const FILL_TO_HIDE_MS = 140;

export function emitNavigationStart() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(NAV_START_EVENT));
}

/**
 * The page being opened is on screen with its content (drawn from the phone's
 * copy over the list, or as the loading screen) — the bar finishes now, not
 * when the server's answer for the page arrives behind it.
 */
export function emitNavigationContentShown() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CONTENT_SHOWN_EVENT));
}

export function emitProgressActivityStart() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(ACTIVITY_START_EVENT));
}

export function emitProgressActivityEnd() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(ACTIVITY_END_EVENT));
}

function hasRouteLoadingSkeleton() {
  if (typeof document === "undefined") return false;
  return Boolean(document.querySelector(ROUTE_LOADING_SELECTOR));
}

export function TopNavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeKey = `${pathname}?${searchParams.toString()}`;
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(0);

  // Painted (after SHOW_AFTER_MS) vs. under way (from the tap on).
  const visibleRef = useRef(false);
  const activeRef = useRef(false);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRouteChangeRef = useRef(false);
  const activityCountRef = useRef(0);
  const fromRouteKeyRef = useRef("");
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const finalizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const observerRef = useRef<MutationObserver | null>(null);
  const seenSkeletonRef = useRef(false);
  // Kept in a ref (not read from a dep array) so the listener-registration
  // effect below doesn't re-run — and tear down its live timers — on every
  // searchParams-only navigation (e.g. tab/filter clicks on the same page).
  // Written from its own effect, not during render (react-hooks/refs) — a
  // separate effect here doesn't touch that other effect's own dependency
  // array, so this still doesn't retrigger it.
  const routeKeyRef = useRef(routeKey);
  useEffect(() => {
    routeKeyRef.current = routeKey;
  }, [routeKey]);

  const clearAllTimers = useCallback(() => {
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
    if (finalizeTimerRef.current) {
      clearTimeout(finalizeTimerRef.current);
      finalizeTimerRef.current = null;
    }
  }, []);

  const disconnectObserver = useCallback(() => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
  }, []);

  // Done: a bar that never got painted just doesn't appear; one that did
  // fills to the end and fades.
  const finish = useCallback(() => {
    clearAllTimers();
    activeRef.current = false;
    if (showTimerRef.current) {
      clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    if (!visibleRef.current) {
      setProgress(0);
      return;
    }
    setProgress(100);
    finalizeTimerRef.current = setTimeout(() => {
      visibleRef.current = false;
      setVisible(false);
      setProgress(0);
    }, FILL_TO_HIDE_MS);
  }, [clearAllTimers]);

  const finalizeIfIdle = useCallback(() => {
    if (pendingRouteChangeRef.current) return;
    if (activityCountRef.current > 0) return;
    finish();
  }, [finish]);

  const monitorSkeletonLifecycle = useCallback(() => {
    clearAllTimers();
    disconnectObserver();

    const startCheckAt = Date.now();
    seenSkeletonRef.current = hasRouteLoadingSkeleton();

    observerRef.current = new MutationObserver(() => {
      const skeletonNow = hasRouteLoadingSkeleton();
      if (skeletonNow) {
        seenSkeletonRef.current = true;
        return;
      }

      if (seenSkeletonRef.current) {
        disconnectObserver();
        finalizeIfIdle();
        return;
      }

      if (Date.now() - startCheckAt >= SKELETON_APPEAR_WAIT_MS) {
        disconnectObserver();
        finalizeIfIdle();
      }
    });

    observerRef.current.observe(document.body, { childList: true, subtree: true });

    // Backup: if no DOM mutation happens, still decide after window — unless a
    // loading screen is up, which the observer ends the bar for when it goes.
    finalizeTimerRef.current = setTimeout(() => {
      if (hasRouteLoadingSkeleton()) return;
      disconnectObserver();
      finalizeIfIdle();
    }, SKELETON_APPEAR_WAIT_MS);

    // Hard failsafe.
    setTimeout(() => {
      if (!activeRef.current) return;
      disconnectObserver();
      clearAllTimers();
      finalizeIfIdle();
    }, FAILSAFE_MS);
  }, [clearAllTimers, disconnectObserver, finalizeIfIdle]);

  useEffect(() => {
    function ensureStarted() {
      clearAllTimers();
      disconnectObserver();
      if (!activeRef.current) {
        activeRef.current = true;
        // A bar still fading out from the last one goes now; this one is
        // painted only if it isn't done within SHOW_AFTER_MS.
        if (visibleRef.current) {
          visibleRef.current = false;
          setVisible(false);
        }
        setProgress(18);
        showTimerRef.current = setTimeout(() => {
          showTimerRef.current = null;
          if (!activeRef.current) return;
          visibleRef.current = true;
          setVisible(true);
        }, SHOW_AFTER_MS);
      }

      progressTimerRef.current = setInterval(() => {
        setProgress((prev) => (prev >= 90 ? prev : prev + 6));
      }, 120);
    }

    function startNavigation() {
      ensureStarted();
      fromRouteKeyRef.current = routeKeyRef.current;
      pendingRouteChangeRef.current = true;
      seenSkeletonRef.current = false;
    }

    function startActivity() {
      activityCountRef.current += 1;
      ensureStarted();
    }

    function endActivity() {
      activityCountRef.current = Math.max(0, activityCountRef.current - 1);
      finalizeIfIdle();
    }

    function contentShown() {
      if (!activeRef.current || !pendingRouteChangeRef.current) return;
      // The address catching up afterwards doesn't start the wait again.
      pendingRouteChangeRef.current = false;
      clearAllTimers();
      disconnectObserver();
      finalizeIfIdle();
    }

    // Global link-click capture — fires startNavigation() for any same-origin
    // anchor click in the app. Previously the bar only showed on explicit
    // emitNavigationStart() calls (sidebar NavLink etc.), so pages like
    // Activity / Settings that navigate via plain <Link> never triggered it.
    function handleDocumentClick(event: MouseEvent) {
      // Skip modified clicks (cmd+click opens new tab, etc.)
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const target = event.target as Element | null;
      const anchor = target?.closest("a");
      if (!anchor || !(anchor instanceof HTMLAnchorElement)) return;
      if (!anchor.href) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;

      try {
        const url = new URL(anchor.href);
        if (url.origin !== window.location.origin) return;
        // Same path + search = hash-only or no-op — don't start a bar
        if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      } catch {
        return;
      }

      startNavigation();
    }

    function handlePopState() {
      startNavigation();
    }

    window.addEventListener(NAV_START_EVENT, startNavigation);
    window.addEventListener(ACTIVITY_START_EVENT, startActivity);
    window.addEventListener(ACTIVITY_END_EVENT, endActivity);
    window.addEventListener(CONTENT_SHOWN_EVENT, contentShown);
    window.addEventListener("click", handleDocumentClick, true);
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener(NAV_START_EVENT, startNavigation);
      window.removeEventListener(ACTIVITY_START_EVENT, startActivity);
      window.removeEventListener(ACTIVITY_END_EVENT, endActivity);
      window.removeEventListener(CONTENT_SHOWN_EVENT, contentShown);
      window.removeEventListener("click", handleDocumentClick, true);
      window.removeEventListener("popstate", handlePopState);
      clearAllTimers();
      disconnectObserver();
      if (showTimerRef.current) clearTimeout(showTimerRef.current);
    };
  }, [clearAllTimers, disconnectObserver, finalizeIfIdle]);

  useEffect(() => {
    if (!activeRef.current) return;
    if (!pendingRouteChangeRef.current) return;
    if (routeKey === fromRouteKeyRef.current) return;

    pendingRouteChangeRef.current = false;
    monitorSkeletonLifecycle();
  }, [monitorSkeletonLifecycle, routeKey]);

  if (!visible) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[120] h-1 bg-transparent">
      <div
        // Sits ON the navy top bar, so it has to be light to be seen at all.
        className="h-full bg-secondary shadow-[0_0_10px_rgb(var(--secondary)/0.7)] transition-[width] duration-150 ease-out"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}

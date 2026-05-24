"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const NAV_START_EVENT = "app:navigation-start";
const ACTIVITY_START_EVENT = "app:progress-activity-start";
const ACTIVITY_END_EVENT = "app:progress-activity-end";
const ROUTE_LOADING_SELECTOR = "[data-route-loading='true']";
const SKELETON_APPEAR_WAIT_MS = 1400;
const MIN_VISIBLE_MS = 500;
const FAILSAFE_MS = 12000;

export function emitNavigationStart() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(NAV_START_EVENT));
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

  const visibleRef = useRef(false);
  const pendingRouteChangeRef = useRef(false);
  const activityCountRef = useRef(0);
  const fromRouteKeyRef = useRef("");
  const navStartedAtRef = useRef<number>(0);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const finalizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const observerRef = useRef<MutationObserver | null>(null);
  const seenSkeletonRef = useRef(false);

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

  const hideAfterMinVisible = useCallback(() => {
    const elapsed = Date.now() - navStartedAtRef.current;
    const wait = Math.max(0, MIN_VISIBLE_MS - elapsed);
    finalizeTimerRef.current = setTimeout(() => {
      setProgress(100);
      finalizeTimerRef.current = setTimeout(() => {
        setVisible(false);
        setProgress(0);
      }, 280);
    }, wait);
  }, []);

  const finalizeIfIdle = useCallback(() => {
    if (pendingRouteChangeRef.current) return;
    if (activityCountRef.current > 0) return;
    hideAfterMinVisible();
  }, [hideAfterMinVisible]);

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

    // Backup: if no DOM mutation happens, still decide after window.
    finalizeTimerRef.current = setTimeout(() => {
      disconnectObserver();
      finalizeIfIdle();
    }, SKELETON_APPEAR_WAIT_MS);

    // Hard failsafe.
    setTimeout(() => {
      if (!visible) return;
      disconnectObserver();
      clearAllTimers();
      finalizeIfIdle();
    }, FAILSAFE_MS);
  }, [clearAllTimers, disconnectObserver, finalizeIfIdle, visible]);

  useEffect(() => {
    function ensureStarted() {
      clearAllTimers();
      disconnectObserver();
      navStartedAtRef.current = Date.now();
      if (!visibleRef.current) {
        setVisible(true);
        setProgress((prev) => (prev > 18 ? prev : 18));
      } else {
        setProgress((prev) => (prev > 18 ? prev : 18));
      }

      progressTimerRef.current = setInterval(() => {
        setProgress((prev) => (prev >= 90 ? prev : prev + 6));
      }, 120);
    }

    function startNavigation() {
      ensureStarted();
      fromRouteKeyRef.current = routeKey;
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

    window.addEventListener(NAV_START_EVENT, startNavigation);
    window.addEventListener(ACTIVITY_START_EVENT, startActivity);
    window.addEventListener(ACTIVITY_END_EVENT, endActivity);
    return () => {
      window.removeEventListener(NAV_START_EVENT, startNavigation);
      window.removeEventListener(ACTIVITY_START_EVENT, startActivity);
      window.removeEventListener(ACTIVITY_END_EVENT, endActivity);
      clearAllTimers();
      disconnectObserver();
    };
  }, [clearAllTimers, disconnectObserver, finalizeIfIdle, routeKey]);

  useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    if (!pendingRouteChangeRef.current) return;
    if (routeKey === fromRouteKeyRef.current) return;

    pendingRouteChangeRef.current = false;
    monitorSkeletonLifecycle();
  }, [monitorSkeletonLifecycle, routeKey, visible]);

  if (!visible) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[120] h-1 bg-transparent">
      <div
        className="h-full bg-primary shadow-[0_0_10px_rgb(var(--primary)/0.6)] transition-[width] duration-150 ease-out"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}

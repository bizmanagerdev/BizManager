"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const NAV_START_EVENT = "app:navigation-start";
const ROUTE_LOADING_SELECTOR = "[data-route-loading='true']";
const SKELETON_APPEAR_WAIT_MS = 1400;
const MIN_VISIBLE_MS = 500;
const FAILSAFE_MS = 12000;

export function emitNavigationStart() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(NAV_START_EVENT));
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

  const pendingRouteChangeRef = useRef(false);
  const fromRouteKeyRef = useRef("");
  const navStartedAtRef = useRef<number>(0);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const finalizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const observerRef = useRef<MutationObserver | null>(null);
  const seenSkeletonRef = useRef(false);

  function clearAllTimers() {
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
    if (finalizeTimerRef.current) {
      clearTimeout(finalizeTimerRef.current);
      finalizeTimerRef.current = null;
    }
  }

  function disconnectObserver() {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
  }

  function hideAfterMinVisible() {
    const elapsed = Date.now() - navStartedAtRef.current;
    const wait = Math.max(0, MIN_VISIBLE_MS - elapsed);
    finalizeTimerRef.current = setTimeout(() => {
      setProgress(100);
      finalizeTimerRef.current = setTimeout(() => {
        setVisible(false);
        setProgress(0);
      }, 280);
    }, wait);
  }

  function monitorSkeletonLifecycle() {
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
        hideAfterMinVisible();
        return;
      }

      if (Date.now() - startCheckAt >= SKELETON_APPEAR_WAIT_MS) {
        disconnectObserver();
        hideAfterMinVisible();
      }
    });

    observerRef.current.observe(document.body, { childList: true, subtree: true });

    // Backup: if no DOM mutation happens, still decide after window.
    finalizeTimerRef.current = setTimeout(() => {
      disconnectObserver();
      hideAfterMinVisible();
    }, SKELETON_APPEAR_WAIT_MS);

    // Hard failsafe.
    setTimeout(() => {
      if (!visible) return;
      disconnectObserver();
      clearAllTimers();
      hideAfterMinVisible();
    }, FAILSAFE_MS);
  }

  useEffect(() => {
    function start() {
      clearAllTimers();
      disconnectObserver();
      navStartedAtRef.current = Date.now();
      fromRouteKeyRef.current = routeKey;
      pendingRouteChangeRef.current = true;
      seenSkeletonRef.current = false;
      setVisible(true);
      setProgress((prev) => (prev > 18 ? prev : 18));

      progressTimerRef.current = setInterval(() => {
        setProgress((prev) => (prev >= 90 ? prev : prev + 6));
      }, 120);
    }

    window.addEventListener(NAV_START_EVENT, start);
    return () => {
      window.removeEventListener(NAV_START_EVENT, start);
      clearAllTimers();
      disconnectObserver();
    };
  }, [routeKey]);

  useEffect(() => {
    if (!visible) return;
    if (!pendingRouteChangeRef.current) return;
    if (routeKey === fromRouteKeyRef.current) return;

    pendingRouteChangeRef.current = false;
    monitorSkeletonLifecycle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey, visible]);

  if (!visible) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[120] h-1 bg-transparent">
      <div
        className="h-full bg-primary shadow-[0_0_10px_hsl(var(--primary)/0.6)] transition-[width] duration-150 ease-out"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}

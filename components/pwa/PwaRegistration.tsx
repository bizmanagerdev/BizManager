"use client";

import { useEffect } from "react";
import { processQueue } from "@/lib/offline-queue";

export default function PwaRegistration() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

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

    void navigator.serviceWorker.register("/sw.js");

    // Listen for the SW telling us to drain the queue (Background Sync fallback path)
    const handleMessage = (event: MessageEvent) => {
      if ((event.data as { type?: string })?.type === "PROCESS_OFFLINE_QUEUE") {
        void processQueue();
      }
    };
    navigator.serviceWorker.addEventListener("message", handleMessage);

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
    };
  }, []);

  return null;
}


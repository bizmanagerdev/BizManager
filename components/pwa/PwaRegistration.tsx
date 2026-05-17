"use client";

import { useEffect } from "react";
import { processQueue } from "@/lib/offline-queue";

export default function PwaRegistration() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

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


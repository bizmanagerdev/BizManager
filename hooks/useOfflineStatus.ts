"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getQueueLength, processQueue as doProcessQueue } from "@/lib/offline-queue";

export function useOfflineStatus() {
  const [isOnline, setIsOnline] = useState(true);
  const [queueLength, setQueueLength] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const processingRef = useRef(false);

  // Sync to browser state on mount
  useEffect(() => {
    setIsOnline(navigator.onLine);
    setQueueLength(getQueueLength());
  }, []);

  const refreshQueue = useCallback(() => {
    setQueueLength(getQueueLength());
  }, []);

  const processQueue = useCallback(async () => {
    if (processingRef.current || !navigator.onLine) return;
    processingRef.current = true;
    setIsProcessing(true);
    try {
      const result = await doProcessQueue();
      setQueueLength(result.remaining);
      return result;
    } finally {
      processingRef.current = false;
      setIsProcessing(false);
    }
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      void processQueue();
    };
    const handleOffline = () => setIsOnline(false);
    // Cross-tab: another tab enqueued or dequeued something
    const handleStorage = (e: StorageEvent) => {
      if (e.key === "biz_offline_queue") refreshQueue();
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("storage", handleStorage);

    // Process any queue left from a previous session
    if (navigator.onLine && getQueueLength() > 0) void processQueue();

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("storage", handleStorage);
    };
  }, [processQueue, refreshQueue]);

  return { isOnline, queueLength, isProcessing, processQueue, refreshQueue };
}

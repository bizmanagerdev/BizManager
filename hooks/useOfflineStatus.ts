"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CONNECTION_EVENTS,
  clearFailed as doClearFailed,
  getFailedLength,
  getQueueLength,
  processQueue as doProcessQueue,
  retryFailed as doRetryFailed,
} from "@/lib/offline-queue";

export function useOfflineStatus() {
  const [isOnline, setIsOnline] = useState(true);
  const [queueLength, setQueueLength] = useState(0);
  const [failedLength, setFailedLength] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const processingRef = useRef(false);

  // Sync to browser state on mount
  useEffect(() => {
    setIsOnline(navigator.onLine);
    setQueueLength(getQueueLength());
    setFailedLength(getFailedLength());
  }, []);

  const refreshCounts = useCallback(() => {
    setQueueLength(getQueueLength());
    setFailedLength(getFailedLength());
  }, []);

  const processQueue = useCallback(async () => {
    if (processingRef.current || !navigator.onLine) return;
    processingRef.current = true;
    setIsProcessing(true);
    try {
      const result = await doProcessQueue();
      refreshCounts();
      return result;
    } finally {
      processingRef.current = false;
      setIsProcessing(false);
    }
  }, [refreshCounts]);

  const retryFailed = useCallback(() => {
    doRetryFailed();
    refreshCounts();
    void processQueue();
  }, [processQueue, refreshCounts]);

  const clearFailed = useCallback(() => {
    doClearFailed();
    refreshCounts();
  }, [refreshCounts]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      void processQueue();
    };
    const handleOffline = () => setIsOnline(false);
    // Cross-tab: another tab enqueued or dequeued something
    const handleStorage = (e: StorageEvent) => {
      if (e.key === "biz_offline_queue" || e.key === "biz_offline_failed") refreshCounts();
    };
    // Same-tab: a write was just queued / drained / parked as failed
    const handleChanged = () => refreshCounts();

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("storage", handleStorage);
    window.addEventListener(CONNECTION_EVENTS.changed, handleChanged);

    // Process any queue left from a previous session
    if (navigator.onLine && getQueueLength() > 0) void processQueue();

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(CONNECTION_EVENTS.changed, handleChanged);
    };
  }, [processQueue, refreshCounts]);

  return {
    isOnline,
    queueLength,
    failedLength,
    isProcessing,
    processQueue,
    refreshQueue: refreshCounts,
    retryFailed,
    clearFailed,
  };
}

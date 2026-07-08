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
import {
  clearFailedUploads,
  getUploadFailedLength,
  getUploadQueueLength,
  processUploadQueue,
  retryFailedUploads,
} from "@/lib/offline-upload";

export function useOfflineStatus() {
  const [isOnline, setIsOnline] = useState(true);
  // Counts combine the JSON write queue (localStorage) and the file-upload
  // queue (IndexedDB) so the banner speaks for both with one number.
  const [queueLength, setQueueLength] = useState(0);
  const [failedLength, setFailedLength] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const processingRef = useRef(false);
  // Upload counts are async (IndexedDB); keep the latest in a ref so combining
  // with the sync JSON counts never races.
  const uploadCounts = useRef({ queue: 0, failed: 0 });

  const refreshCounts = useCallback(() => {
    void (async () => {
      const [uQueue, uFailed] = await Promise.all([
        getUploadQueueLength(),
        getUploadFailedLength(),
      ]);
      uploadCounts.current = { queue: uQueue, failed: uFailed };
      setQueueLength(getQueueLength() + uQueue);
      setFailedLength(getFailedLength() + uFailed);
    })();
  }, []);

  // Sync to browser state on mount
  useEffect(() => {
    setIsOnline(navigator.onLine);
    refreshCounts();
  }, [refreshCounts]);

  const processQueue = useCallback(async () => {
    if (processingRef.current || !navigator.onLine) return;
    processingRef.current = true;
    setIsProcessing(true);
    try {
      const [jsonResult] = await Promise.all([doProcessQueue(), processUploadQueue()]);
      refreshCounts();
      return jsonResult;
    } finally {
      processingRef.current = false;
      setIsProcessing(false);
    }
  }, [refreshCounts]);

  const retryFailed = useCallback(() => {
    doRetryFailed();
    void retryFailedUploads().then(refreshCounts);
    refreshCounts();
    void processQueue();
  }, [processQueue, refreshCounts]);

  const clearFailed = useCallback(() => {
    doClearFailed();
    void clearFailedUploads().then(refreshCounts);
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
    // Same-tab: a write/upload was just queued / drained / parked as failed.
    // (IndexedDB fires no cross-tab storage event, so upload counts sync
    // cross-tab only on the next refresh — acceptable; same-tab is covered here.)
    const handleChanged = () => refreshCounts();

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("storage", handleStorage);
    window.addEventListener(CONNECTION_EVENTS.changed, handleChanged);

    // Drain anything left from a previous session (JSON writes or file uploads).
    // processQueue no-ops when both queues are empty, so an unconditional kick
    // when online is safe and also covers the async IndexedDB upload queue.
    if (navigator.onLine) void processQueue();

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

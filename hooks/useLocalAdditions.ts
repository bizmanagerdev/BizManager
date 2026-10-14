"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CONNECTION_EVENTS } from "@/lib/offline-queue";

export type LocalRow = { id: string; waiting?: boolean };

/**
 * Rows a page added itself, on top of the list the server read — so a save
 * shows at once instead of after the whole page is read again.
 *
 * A row saved with no connection is `waiting` (its id is the page's own; the
 * server hasn't numbered it yet). When the send queue reports that it went
 * out, the page is read again once, and the waiting rows give way to the real
 * ones in the fresh list. A row the server's list already holds (same id) is
 * shown once, from the server.
 */
export function useLocalAdditions<T extends LocalRow>(serverRows: readonly T[]) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [added, setAdded] = useState<T[]>([]);
  // Set when the queue went out; the next fresh list replaces the waiting rows.
  const [awaitingFresh, setAwaitingFresh] = useState(false);
  const [seen, setSeen] = useState(serverRows);
  if (serverRows !== seen) {
    setSeen(serverRows);
    if (awaitingFresh) {
      setAwaitingFresh(false);
      setAdded((prev) => prev.filter((row) => !row.waiting));
    }
  }

  const hasWaiting = added.some((row) => row.waiting);
  useEffect(() => {
    if (!hasWaiting) return;
    const onSynced = () => {
      setAwaitingFresh(true);
      startTransition(() => {
        router.refresh();
      });
    };
    window.addEventListener(CONNECTION_EVENTS.synced, onSynced);
    return () => window.removeEventListener(CONNECTION_EVENTS.synced, onSynced);
  }, [hasWaiting, router]);

  const rows = useMemo(() => {
    const serverIds = new Set(serverRows.map((row) => row.id));
    return [...added.filter((row) => !serverIds.has(row.id)), ...serverRows];
  }, [added, serverRows]);

  const add = useCallback((row: T) => setAdded((prev) => [row, ...prev.filter((r) => r.id !== row.id)]), []);
  const remove = useCallback((id: string) => setAdded((prev) => prev.filter((r) => r.id !== id)), []);

  return { rows, add, remove };
}

/** An id for a row saved with no connection — the page's own until the server numbers it. */
export function waitingRowId(): string {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `waiting-${random}`;
}

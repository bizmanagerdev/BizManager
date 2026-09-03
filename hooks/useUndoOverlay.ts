"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { subscribeUndo, getUndoVersion, isUndoHidden, getUndoPatch } from "@/lib/undo-engine";

/**
 * Applies pending undo-engine hide/patch overlays on top of a server-fetched
 * props array, without copying it into local React state. Same
 * useSyncExternalStore shape as hooks/useOfflineRows.ts's useOnline().
 */
export function useUndoOverlay<T>(items: T[], getKey: (item: T) => string, scope: string): T[] {
  const subscribe = useCallback((cb: () => void) => subscribeUndo(cb), []);
  const versionSnapshot = useSyncExternalStore(subscribe, getUndoVersion, () => 0);

  return useMemo(() => {
    void versionSnapshot; // re-run this memo whenever engine state changes
    return items
      .filter((item) => !isUndoHidden(scope, getKey(item)))
      .map((item) => {
        const patch = getUndoPatch(scope, getKey(item));
        return patch ? { ...item, ...(patch as Partial<T>) } : item;
      });
  }, [items, scope, getKey, versionSnapshot]);
}

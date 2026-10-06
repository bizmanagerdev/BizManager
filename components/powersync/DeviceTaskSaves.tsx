"use client";

import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { toast } from "sonner";
import { useLocalDatabase } from "@/lib/powersync/store";
import {
  DEVICE_SAVE_REFUSED_EVENT,
  deleteTaskOnDevice,
  moveTaskOnDevice,
  type DeviceSaveRefused,
} from "@/lib/powersync/local-writes";

// The tasks board's saves on the device copy (lib/powersync/local-writes.ts):
// provided by the board's device version (LocalTasksBoard); the board uses them
// instead of calling the server when they're there. Also shows the person why,
// when the server refuses one of them later.

export type DeviceTaskSaves = {
  move: (id: string, status: string, sortOrder: number) => Promise<void>;
  remove: (id: string) => Promise<void>;
};

const DeviceTaskSavesContext = createContext<DeviceTaskSaves | null>(null);

export function DeviceTaskSavesProvider({
  refusedTitles,
  children,
}: {
  /** The toast's title per kind of save the server refused (the page's own wording). */
  refusedTitles: Record<DeviceSaveRefused["kind"], string>;
  children: ReactNode;
}) {
  const db = useLocalDatabase();
  const saves = useMemo<DeviceTaskSaves | null>(
    () =>
      db
        ? {
            move: (id, status, sortOrder) => moveTaskOnDevice(db, id, status, sortOrder),
            remove: (id) => deleteTaskOnDevice(db, id),
          }
        : null,
    [db]
  );

  const { "task-status": statusTitle, "task-delete": deleteTitle } = refusedTitles;
  useEffect(() => {
    const onRefused = (event: Event) => {
      const { kind, message } = (event as CustomEvent<DeviceSaveRefused>).detail;
      toast.error(kind === "task-delete" ? deleteTitle : statusTitle, { description: message });
    };
    window.addEventListener(DEVICE_SAVE_REFUSED_EVENT, onRefused);
    return () => window.removeEventListener(DEVICE_SAVE_REFUSED_EVENT, onRefused);
  }, [statusTitle, deleteTitle]);

  return <DeviceTaskSavesContext.Provider value={saves}>{children}</DeviceTaskSavesContext.Provider>;
}

/** The device's task saves, or null (the server version: save on the server). */
export function useDeviceTaskSaves(): DeviceTaskSaves | null {
  return useContext(DeviceTaskSavesContext);
}

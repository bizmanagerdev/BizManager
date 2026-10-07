"use client";

import { useSyncExternalStore } from "react";
import { deviceCopyPending } from "@/lib/powersync/device-pending";

const neverChanges = () => () => {};

/**
 * Is this device's copy still incomplete (lib/powersync/device-pending.ts)?
 * False on the server and while hydrating, so the HTML always matches; the
 * cookie afterwards, read again whenever the component renders.
 */
export function useDeviceCopyPending(): boolean {
  return useSyncExternalStore(neverChanges, deviceCopyPending, () => false);
}

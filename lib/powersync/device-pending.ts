// A device whose copy hasn't finished downloading yet can't draw the device
// pages: the first time on a new device or after a logout, or on a network
// that blocks the sync service (a filtered internet). It says so with this
// cookie, and the server then sends those pages' server version right away
// (devicePageOn in lib/powersync/device-check.ts) — instead of a page that
// waits for the copy and gives up after a few seconds. LocalDataHost keeps it
// in step with the copy: set while it's incomplete, removed the moment the
// first download completes, and the device pages then take over by
// themselves. A device page that finds the copy incomplete sets it too
// (useLocalCard), for a device whose copy never even opens.

export const DEVICE_COPY_PENDING_COOKIE = "bizh-device-pending";

/** Without news for this long it goes, and the device pages are tried again. */
const MAX_AGE_S = 7 * 24 * 60 * 60;

/** Is this device's copy known to be incomplete? (Browser only; false on the server.) */
export function deviceCopyPending(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie.split(";").some((part) => part.trim().startsWith(`${DEVICE_COPY_PENDING_COOKIE}=`));
}

export function setDeviceCopyPending(pending: boolean): void {
  if (typeof document === "undefined") return;
  if (!pending && !deviceCopyPending()) return;
  document.cookie = pending
    ? `${DEVICE_COPY_PENDING_COOKIE}=1; path=/; max-age=${MAX_AGE_S}; samesite=lax`
    : `${DEVICE_COPY_PENDING_COOKIE}=; path=/; max-age=0; samesite=lax`;
}

import { cookies } from "next/headers";
import { israelDateKey } from "@/lib/timezone";
import { localDataPageOn } from "./config";
import { DEVICE_COPY_PENDING_COOKIE } from "./device-pending";

/**
 * Does this person get the device version of `page` on the device asking?
 * Not while that device's copy is still incomplete (its cookie, from
 * lib/powersync/device-pending.ts): the server version then, at once.
 */
export async function devicePageOn(
  page: DeviceCheckPage,
  viewer: { id: string; role: string | null | undefined }
): Promise<boolean> {
  if (!localDataPageOn(page, viewer)) return false;
  return !(await cookies()).has(DEVICE_COPY_PENDING_COOKIE);
}

// Pages drawn from the device copy still compare themselves with the server's
// version — once a day per device and page. The device says it has done
// today's (DashboardLocalShadow's `doneCookie`); until it has, the page's
// server version is also worked out, streamed after the page so it never
// holds the page up, and compared on the device.

export type DeviceCheckPage = "dashboard" | "tasks" | "projects" | "sales";

/** The cookie a device sets once it has compared `page` today. */
export function deviceCheckCookie(page: DeviceCheckPage): string {
  return `bizh-shadow-${page}`;
}

/** Does this device still have to compare `page` today? */
export async function deviceCheckDue(page: DeviceCheckPage): Promise<boolean> {
  const jar = await cookies();
  return jar.get(deviceCheckCookie(page))?.value !== israelDateKey();
}

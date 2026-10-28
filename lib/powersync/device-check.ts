import { cookies, headers } from "next/headers";
import { israelDateKey } from "@/lib/timezone";
import { localDataPageOn } from "./config";
import { DEVICE_COPY_PENDING_COOKIE } from "./device-pending";
import { BANK_COPY_COOKIE, MONEY_COPY_COOKIE } from "./money-copy";

/**
 * Does this person's dashboard draw its money cards from the device? Only on
 * the device version of the board, and only where the copy is known to carry
 * the money tables (lib/powersync/money-copy.ts) — elsewhere the server works
 * them out, as before.
 */
export async function moneyCardsOnDevice(viewer: { id: string; role: string | null | undefined }): Promise<boolean> {
  if (!localDataPageOn("dashboardMoney", viewer)) return false;
  return (await cookies()).get(MONEY_COPY_COOKIE)?.value === "1";
}

/** Pages that need tables only a later copy has: the device says it has them (lib/powersync/money-copy.ts). */
const COPY_MARK_COOKIES: Partial<Record<DeviceCheckPage, string>> = { bank: BANK_COPY_COOKIE, cashFlow: MONEY_COPY_COOKIE };

/**
 * Does this person get the device version of `page` on the device asking?
 * Not while that device's copy is still incomplete (its cookie, from
 * lib/powersync/device-pending.ts), nor where the copy doesn't have the
 * page's tables yet: the server version then, at once.
 */
export async function devicePageOn(
  page: DeviceCheckPage,
  viewer: { id: string; role: string | null | undefined; locale?: string | null }
): Promise<boolean> {
  if (!localDataPageOn(page, viewer)) return false;
  const jar = await cookies();
  if (jar.has(DEVICE_COPY_PENDING_COOKIE)) return false;
  const mark = COPY_MARK_COOKIES[page];
  return !mark || jar.get(mark)?.value === "1";
}

// Pages drawn from the device copy still compare themselves with the server's
// version — once a day per device and page. The device says it has done
// today's (DashboardLocalShadow's `doneCookie`); until it has, the page's
// server version is also worked out, streamed after the page so it never
// holds the page up, and compared on the device.

export type DeviceCheckPage =
  | "dashboard"
  | "tasks"
  | "projects"
  | "sales"
  | "orders"
  | "projectPage"
  | "deliveries"
  | "customers"
  | "customerPage"
  | "properties"
  | "propertyPage"
  | "rentRoll"
  | "bank"
  | "cashFlow";

/** The cookie a device sets once it has compared `page` today. */
export function deviceCheckCookie(page: DeviceCheckPage): string {
  return `bizh-shadow-${page}`;
}

/**
 * Sent by the service worker when it saves a page's frame in the background
 * (public/sw.js, SAVE_FRAMES) — nobody is looking at it, so no comparison.
 */
export const FRAME_SAVE_HEADER = "x-bizh-frame-save";

/**
 * Is this the service worker saving the page's frame in the background? A
 * record's page then leaves out its history too — the costliest of its server
 * reads and the least needed with no connection (owner, 2026-10-25: "do 1");
 * opened online, the page refreshes its server parts and the history comes.
 */
export async function savingFrameInBackground(): Promise<boolean> {
  return (await headers()).get(FRAME_SAVE_HEADER) === "1";
}

/** Does this device still have to compare `page` today? */
export async function deviceCheckDue(page: DeviceCheckPage): Promise<boolean> {
  if (await savingFrameInBackground()) return false;
  const jar = await cookies();
  return jar.get(deviceCheckCookie(page))?.value !== israelDateKey();
}

import type { SupabaseClient } from "@supabase/supabase-js";

// The dashboard's money cards need tables a copy synced before sync rules
// v1.8 doesn't have (loans, card statements, settlements…) — and an empty
// table on a copy that simply hasn't received it yet would read as "no loans",
// a wrong figure with nothing to say so. The rules mark the copies that have
// them: business_settings.money_tables = 1, which arrives in the same complete
// download as the tables themselves. Only such a copy works the money cards
// out (lib/powersync/dashboard-local.ts), and LocalDataHost tells the server
// with this cookie, so the board draws them from the device only where the
// copy can (moneyCardsOnDevice in lib/powersync/device-check.ts) — elsewhere
// the server's version, as before. Client-safe.
//
// The accounts page (/financial/bank) the same way, from sync rules v1.14:
// business_settings.bank_tables = 1 (transfers, the bank-check ticks, the
// exchange rates, the quick line's filing) and BANK_COPY_COOKIE. And the
// payments calendar from v1.15: calendar_tables = 1 (the payment promises, the
// recurring bills' whole rule) and CALENDAR_COPY_COOKIE.

export const MONEY_COPY_COOKIE = "bizh-money-copy";
export const BANK_COPY_COOKIE = "bizh-bank-copy";
export const CALENDAR_COPY_COOKIE = "bizh-calendar-copy";

/** Without news for this long it goes (the server version until the device says again). */
const MAX_AGE_S = 7 * 24 * 60 * 60;

/** Which of the marked table sets this copy carries. */
export async function copyTableMarks(local: SupabaseClient): Promise<{ money: boolean; bank: boolean; calendar: boolean }> {
  const { data, error } = await local.from("business_settings").select("money_tables,bank_tables,calendar_tables").limit(1);
  if (error || !Array.isArray(data) || data.length === 0) return { money: false, bank: false, calendar: false };
  const row = data[0] as { money_tables?: unknown; bank_tables?: unknown; calendar_tables?: unknown };
  return { money: row.money_tables === 1, bank: row.bank_tables === 1, calendar: row.calendar_tables === 1 };
}

/** Does this copy carry the money tables (sync rules v1.8 or later)? */
export async function copyHasMoneyTables(local: SupabaseClient): Promise<boolean> {
  return (await copyTableMarks(local)).money;
}

/** Does this copy carry the accounts page's tables (sync rules v1.14 or later)? */
export async function copyHasBankTables(local: SupabaseClient): Promise<boolean> {
  return (await copyTableMarks(local)).bank;
}

/** Does this copy carry everything the payments calendar reads (sync rules v1.15 or later)? */
export async function copyHasCalendarTables(local: SupabaseClient): Promise<boolean> {
  const marks = await copyTableMarks(local);
  return marks.money && marks.bank && marks.calendar;
}

function cookieSet(name: string): boolean {
  return document.cookie.split(";").some((part) => part.trim().startsWith(`${name}=`));
}

function setCopyCookie(name: string, ready: boolean): void {
  if (typeof document === "undefined") return;
  // Ready: (re)set, so it lasts as long as the copy keeps saying so.
  if (!ready && !cookieSet(name)) return;
  document.cookie = ready
    ? `${name}=1; path=/; max-age=${MAX_AGE_S}; samesite=lax`
    : `${name}=; path=/; max-age=0; samesite=lax`;
}

export function setMoneyCopyReady(ready: boolean): void {
  setCopyCookie(MONEY_COPY_COOKIE, ready);
}

export function setBankCopyReady(ready: boolean): void {
  setCopyCookie(BANK_COPY_COOKIE, ready);
}

export function setCalendarCopyReady(ready: boolean): void {
  setCopyCookie(CALENDAR_COPY_COOKIE, ready);
}

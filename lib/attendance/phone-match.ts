import { normalizePhone } from "@/lib/search/customerMatch";

/**
 * Match an inbound caller-ID against a worker's stored phone.
 *
 * The provider sends the number in local Israeli form WITHOUT the 972 prefix (e.g. 0501234567),
 * while a worker's saved phone might be 05x, +9725x, or written with separators. We normalize both
 * (normalizePhone folds 972→0) and, as a safety net, also compare the last 9 digits — the mobile
 * subscriber number — so a missing leading 0 on either side still matches.
 */
export function callerMatchesStored(caller: string | null | undefined, stored: string | null | undefined): boolean {
  const c = normalizePhone(caller);
  const s = normalizePhone(stored);
  if (!c || !s) return false;
  if (c === s) return true;

  const cTail = c.length >= 9 ? c.slice(-9) : c;
  const sTail = s.length >= 9 ? s.slice(-9) : s;
  return cTail.length >= 9 && cTail === sTail;
}

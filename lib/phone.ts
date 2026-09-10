// Folds an Israeli country-code prefix onto the local 0-prefixed dialing form
// used everywhere else in the app (052-1234567, not +972-52-1234567). Numbers
// come in from all over — typed by hand, pasted from a WhatsApp chat where the
// contact's own phone showed it in international form — and only the ones that
// are actually Israeli should be touched.
//
// A genuinely foreign number (a US number, say) must never be "ruined" by
// this: it's returned completely untouched. The only numbers this folds are
// ones carrying +972 / 00972 / a bare 972 prefix, and even then only at the
// exact digit length a real Israeli number has (972 + 8 or 9 digits) — a
// number that merely happens to start with the digits "972" (Dallas' own
// NANP area code, for one) is the wrong length and is left alone.
export function normalizeIsraeliPhone(value: string | null | undefined): string | null | undefined {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return trimmed;

  const digits = trimmed.replace(/\D/g, "");

  if (digits.startsWith("00972") && (digits.length === 13 || digits.length === 14)) {
    return "0" + digits.slice(5);
  }
  if (digits.startsWith("972") && (digits.length === 11 || digits.length === 12)) {
    return "0" + digits.slice(3);
  }
  return trimmed;
}

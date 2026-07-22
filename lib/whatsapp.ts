// One place to turn a stored Israeli phone/whatsapp number into a wa.me link.
//
// Stored numbers are whatever someone typed — "052-123-4567", "+972 52 1234567",
// "0521234567". wa.me accepts none of those: it wants bare international digits.
// Every caller was reimplementing the same 0→972 fold, so it lives here now.

/**
 * Build a wa.me link, optionally with a prefilled message.
 * Returns null when there is no usable number, so callers can skip the link
 * entirely rather than render one that opens WhatsApp to nowhere.
 */
export function whatsappHref(number: string | null | undefined, message?: string): string | null {
  if (!number) return null;
  let digits = number.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("0")) digits = `972${digits.slice(1)}`;
  else if (!digits.startsWith("972")) digits = `972${digits}`;
  // No `?text=` at all when there's no message — an empty one still opens
  // WhatsApp with a blank draft, which reads as a glitch.
  return message ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}` : `https://wa.me/${digits}`;
}

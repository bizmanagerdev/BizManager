/**
 * The parts of a phone list card — an order, a project, a delivery stop — so
 * every list draws the same card (owner, 2026-10-11: "name first"). In order,
 * top to bottom: the NAME (what you scan a list for), the who/where line under
 * it, then the status pills. The orders cards' layout; the projects cards had
 * the status line on top, more padding and a bigger name, and the delivery
 * stops a third weight.
 */

/** The card's inner padding. */
export const LIST_CARD_BODY = "p-3";

/** The first line: the customer or the project. */
export const LIST_CARD_NAME = "text-sm font-semibold leading-snug";

/** The who/where line under the name: city, phone, date. */
export const LIST_CARD_META = "text-xs text-muted-foreground";

/** A status pill on a card — one size for every list. */
export const LIST_CARD_BADGE = "px-2 py-0.5 text-[0.647rem] font-medium";

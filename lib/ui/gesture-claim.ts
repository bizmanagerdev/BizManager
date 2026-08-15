/**
 * A one-line handshake between a widget that drags sideways (a swipe-actions
 * row) and a page-level gesture that also reads sideways drags (swipe to change
 * tab). The widget CLAIMS the gesture as the finger goes down; the page hook
 * consumes the claim when the finger lifts and stands down if there was one.
 *
 * Why a claim rather than "is the touch inside something swipeable?": working
 * that out from the DOM kept missing cases — the target is an <svg> for a touch
 * on an icon (so an `instanceof HTMLElement` walk stops dead), the element can be
 * re-rendered mid-gesture, and a widget that moves by `transform` never touches
 * scrollLeft, so there's nothing to observe. The widget, on the other hand,
 * always knows: it received the pointerdown, or it didn't.
 *
 * Pointer events fire for touch too, and `pointerdown` lands before `touchend`,
 * so the claim is always in place by the time the page hook reads it.
 */

let claimed = false;

/** Called by a widget on pointerdown: "this drag is mine". */
export function claimHorizontalGesture() {
  claimed = true;
}

/**
 * Reads AND clears — one claim covers exactly one gesture, so a claim can never
 * leak into the next one and silently kill a real page swipe.
 */
export function consumeHorizontalGestureClaim() {
  const was = claimed;
  claimed = false;
  return was;
}

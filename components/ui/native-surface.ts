"use client";

// The one thing an open dialog cannot see: a surface the OS or the browser
// draws ON TOP of the page. A date picker opened with showPicker(), a native
// <select>'s option list, the file chooser, a camera/mic permission prompt, the
// share sheet — none of them are in the DOM, and none of them are ours.
//
// That matters because of how Radix decides you clicked outside a dialog. Its
// whole test is "did this pointerdown pass through the content's React tree on
// the way to the document?" (usePointerDownOutside in
// @radix-ui/react-dismissable-layer — there is no DOM containment check, and no
// concept of a layer the page doesn't own). A native surface fails that test
// from both ends: the taps that drive it never reach the page at all, and the
// tap that dismisses it gets handed down to the page underneath, where it lands
// on the dialog's own full-bleed backdrop. Radix reads that as "the user
// reached past the dialog" and dismisses — which on a FormDialog is the
// unsaved-changes prompt instead of the date the user just picked (user report,
// 2026-09-15: every dialog with a date field became impossible to finish —
// answering the prompt and tapping the calendar again just repeated it).
//
// So the arrangement is: whoever hands the user to one of those surfaces arms
// this guard, and every dialog throws away the one outside-interaction that
// comes back. Typing a date by hand never goes near any of this, which is
// exactly why that path always worked.
//
// The guard is deliberately short-lived — it survives exactly one pointer
// event, wherever that event lands — so it can never swallow an unrelated tap
// later on. The cost of that design is bounded and visible: if no replayed tap
// arrives, the guard is spent by the user's own next tap, so a deliberate
// backdrop tap immediately after using a picker can need a second tap. That is
// the right way round — a dialog that needs one extra tap to dismiss beats a
// dialog that dismisses itself and throws away a half-filled form.

let armed = false;
let listening = false;

function disarm() {
  armed = false;
  if (!listening) return;
  listening = false;
  document.removeEventListener("pointerdown", handleAnyPointerDown, true);
}

function handleAnyPointerDown() {
  // Disarm AFTER this event finishes dispatching, not during it. This runs in
  // the capture phase; if this IS the replayed tap, the dialog's
  // onInteractOutside still has to see the guard on the way back up.
  window.setTimeout(disarm, 0);
}

/**
 * Call immediately before handing the user to an OS-drawn surface, so the tap
 * that dismisses it isn't mistaken for a tap on a dialog's backdrop.
 */
export function armNativeSurfaceGuard() {
  if (typeof document === "undefined") return;
  armed = true;
  if (listening) return;
  listening = true;
  document.addEventListener("pointerdown", handleAnyPointerDown, true);
}

/**
 * True at most once per armed surface: "this outside-interaction is the page
 * being handed back by a native surface, not the user reaching for the
 * backdrop." Consuming it disarms the guard.
 */
export function consumeNativeSurfaceGuard() {
  if (!armed) return false;
  disarm();
  return true;
}

/** Test seam — drops the guard without consuming it. */
export function resetNativeSurfaceGuard() {
  disarm();
}

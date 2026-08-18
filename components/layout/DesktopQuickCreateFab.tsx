"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { QuickCreateMenu } from "@/components/layout/QuickCreateMenu";

// No reactive source — this only answers "are we on the client yet".
const subscribe = () => () => {};

/**
 * The desktop quick-create +, floating over the bottom-LEFT corner of the screen.
 *
 * Portaled to <body> ON PURPOSE. A `position: fixed` element is anchored to the
 * nearest ancestor with a transform / filter / backdrop-filter / contain, not to
 * the viewport — the shell is full of those (the blurred top bar, card frames),
 * and the FAB landed in the wrong corner when it was rendered inside the tree.
 * From <body> there is no ancestor left to capture it. Physical `left`, not the
 * logical `end`, for the same reason: one less thing to resolve differently.
 *
 * `hidden md:block` rather than unmounted on a phone: this instance owns the
 * `bizh:quick-create` window event (the calendar's "add to this day", the
 * accounts page's + / −), which has to keep working at every width — the visible
 * + down there is the bottom nav's FAB.
 */
export function DesktopQuickCreateFab({ viewerRole }: { viewerRole?: string }) {
  // Server render → false, so nothing is emitted into the SSR HTML and there's
  // no hydration mismatch; the portal appears on the client re-render.
  const onClient = useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );
  if (!onClient) return null;

  return createPortal(
    <div className="fixed bottom-6 left-6 z-40 hidden md:block">
      <QuickCreateMenu viewerRole={viewerRole} variant="desktopFab" />
    </div>,
    document.body
  );
}

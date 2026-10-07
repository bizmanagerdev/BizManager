"use client";

// Lets a page put its search / filter row INSIDE the dark mobile header, so the
// header reads as one block (title, then the controls for what's under it)
// instead of the page repeating itself in a second, lighter toolbar below.
//
// A DOM portal rather than context state: the toolbar is page-owned JSX with
// page-owned state, and storing a ReactNode in context would re-render the whole
// shell on every keystroke in the search box.
//
// Mobile only — on desktop the sidebar says where you are and the page has room
// for its own toolbar.

import { useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

export const PAGE_HEADER_TOOLBAR_ID = "page-header-toolbar";

// "Are we on the client yet?" — via useSyncExternalStore rather than
// setState-in-an-effect, which triggers a second render pass (and the
// react-hooks lint rule). Nothing ever changes, so subscribe is a no-op.
const noopSubscribe = () => () => {};

/**
 * Holds the strip open for a toolbar that's on its way — the marker alone, for
 * a page drawn from the device copy: its server HTML is a placeholder (the
 * page's toolbar arrives with the page, after the copy answers), so without
 * this the strip popped open then and pushed the page down by its height
 * (phone layout shift on /projects, /tasks and /sales, 2026-10-07). Only on a
 * page that WILL put a toolbar there — otherwise it's an empty strip.
 */
export function PageHeaderToolbarSpace() {
  return <span hidden data-page-header-toolbar="" />;
}

export function PageHeaderToolbar({ children }: { children: ReactNode }) {
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  );

  // The slot is rendered by AppShell, above us in the tree, so it's in the DOM
  // by the time we render on the client.
  const host = mounted ? document.getElementById(PAGE_HEADER_TOOLBAR_ID) : null;

  // The marker is in the server HTML, unlike the portal: it tells the slot to
  // hold its space open before the portal fills it, so the page doesn't jump
  // down when it does (see the [data-page-header-toolbar] rule in globals.css).
  return (
    <>
      <span hidden data-page-header-toolbar="" />
      {host ? createPortal(children, host) : null}
    </>
  );
}

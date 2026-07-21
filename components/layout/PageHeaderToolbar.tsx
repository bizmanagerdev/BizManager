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

export function PageHeaderToolbar({ children }: { children: ReactNode }) {
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  );
  if (!mounted) return null;

  // The slot is rendered by AppShell, above us in the tree, so it's in the DOM
  // by the time we render on the client.
  const host = document.getElementById(PAGE_HEADER_TOOLBAR_ID);
  if (!host) return null;
  return createPortal(children, host);
}

"use client";

import { useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { PAGE_HEADER_TOOLBAR_ID } from "@/components/layout/PageHeaderToolbar";
import ProjectPagePreview from "@/app/(app)/projects/[id]/ProjectPagePreview";
import type { ProjectPreview } from "@/app/(app)/projects/[id]/projectPreview";

// The project page, drawn over the projects list the moment a row is tapped
// on a phone — before the router has anything to show. A phone has no hover
// to load the page ahead of the tap, so without this the list just sits there
// until the server's first bytes arrive. The list unmounts as soon as the
// route changes, and this goes with it; the page's loading screen draws the
// same preview in the same place, so the hand-over doesn't flicker.
//
// Laid over the list rather than swapped in for it: the list keeps its scroll
// position, which is what the browser saves for the back button. And held
// outside the list's own state, so a tap re-renders this alone, not every row.

type PageContentBox = { top: number; left: number; width: number };

/**
 * Where page content starts on screen right now: the content column's left
 * edge and width, and its top below the top bar and the alert bar — over the
 * page's own search/filter row, which a project page doesn't have.
 */
function measurePageContentBox(): PageContentBox | null {
  const main = document.querySelector("main");
  if (!main) return null;
  const mainRect = main.getBoundingClientRect();
  let top = mainRect.top;
  const toolbar = document.getElementById(PAGE_HEADER_TOOLBAR_ID);
  if (toolbar) {
    const toolbarRect = toolbar.getBoundingClientRect();
    // Hidden past `md` (and when empty): then the alert bar above it is the
    // last thing that stays.
    top =
      toolbarRect.height > 0
        ? toolbarRect.top
        : (toolbar.parentElement?.getBoundingClientRect().bottom ?? top);
  }
  return { top: Math.max(0, top), left: mainRect.left, width: mainRect.width };
}

let opening: { preview: ProjectPreview; box: PageContentBox } | null = null;
const listeners = new Set<() => void>();

function setOpening(next: typeof opening) {
  opening = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Put `preview` up over the list — on phones and tablets only. A mouse
 * fetched the page ahead while resting on the row (rowNavigateProps), so it
 * usually opens at once, and covering the list for that moment would only
 * flash grey blocks.
 */
export function showProjectOpening(preview: ProjectPreview) {
  if (!window.matchMedia("(hover: none)").matches) return;
  const box = measurePageContentBox();
  if (box) setOpening({ preview, box });
}

// If the page never arrives (a failed request leaves the router where it
// was), give the list back rather than leave a skeleton up for good.
const GIVE_UP_MS = 15_000;

/** Rendered once by the list; shows the overlay while a tap is opening a project. */
export default function ProjectOpeningOverlay() {
  const current = useSyncExternalStore(subscribe, () => opening, () => null);

  // The list is going (the route changed): the overlay goes with it.
  useEffect(() => () => {
    opening = null;
  }, []);

  useEffect(() => {
    if (!current) return;
    const timer = setTimeout(() => setOpening(null), GIVE_UP_MS);
    return () => clearTimeout(timer);
  }, [current]);

  if (!current) return null;
  const { preview, box } = current;
  return createPortal(
    // Above the sticky alert/search strip (z-20), below the top bar (z-30)
    // and the bottom nav (z-50). touch-none: a drag on it would only scroll
    // the hidden list underneath.
    <div
      className="fixed bottom-0 z-[21] touch-none overflow-hidden bg-background"
      style={{ top: box.top, left: box.left, width: box.width }}
    >
      {/* The same box as AppShell's page wrapper, so the header lands where
          the page's own will. */}
      <div className="mx-auto w-full max-w-[1600px] px-3 py-4 md:p-6 lg:p-8">
        <ProjectPagePreview preview={preview} />
      </div>
    </div>,
    document.body
  );
}

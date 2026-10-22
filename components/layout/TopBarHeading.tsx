"use client";

// A detail page's heading IN THE TOP BAR, on a computer (owner, 2026-10-22: "on
// the detail pages, we put the word, the arrow, and the name, and the two
// buttons into the top bar … this is all only for desktop"): "נכסים › ריבל 29"
// beside the back arrow, and its edit and ⋮ by the bar's own icons — so the
// page has no heading row of its own and starts higher. The phone keeps its
// own layout.
//
// A DOM portal into two slots the bar holds (TopBar), not context state, as the
// phone's PageHeaderToolbar: the heading and its buttons are page-owned JSX
// with page-owned state and context — the buttons' dialogs, the page's menus —
// and they stay mounted in the page's tree wherever they show.

import { useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ChevronLeftIcon } from "@/components/ui/icons";

export const TOP_BAR_HEADING_ID = "top-bar-heading";
export const TOP_BAR_ACTIONS_ID = "top-bar-actions";

const noopSubscribe = () => () => {};

export function TopBarHeading({
  section,
  href,
  title,
  actions,
}: {
  /** Where it belongs: "נכסים", "מכירות", "פרויקטים", "לקוחות". */
  section: string;
  /** That section's page. */
  href: string;
  /** The record's name (and anything that belongs beside it — a project's kind). */
  title: ReactNode;
  /** Its edit and ⋮ — mounted here whatever the width (their dialogs and the phone's menu live with them). */
  actions?: ReactNode;
}) {
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  );
  // The slots are rendered by TopBar, above us in the tree, so they're in the DOM by the time we render.
  const headingHost = mounted ? document.getElementById(TOP_BAR_HEADING_ID) : null;
  const actionsHost = mounted ? document.getElementById(TOP_BAR_ACTIONS_ID) : null;

  return (
    <>
      {headingHost
        ? createPortal(
            <nav className="flex min-w-0 items-center gap-1.5" aria-label="ניווט">
              <Link href={href} className="shrink-0 text-sm text-muted-foreground hover:text-foreground hover:underline">
                {section}
              </Link>
              <ChevronLeftIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <h1 className="flex min-w-0 items-center gap-2 text-base font-bold tracking-tight">{title}</h1>
            </nav>,
            headingHost
          )
        : null}
      {actionsHost && actions ? createPortal(actions, actionsHost) : null}
    </>
  );
}

import type { KeyboardEvent, MouseEvent } from "react";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";

// Skip row-level navigation when the click/keydown originated on an interactive
// element inside the row (so per-row buttons/links still work as expected).
// `row` is the element the row handler sits on (the event's currentTarget).
export function shouldIgnoreRowNavigation(target: EventTarget | null, row?: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  // closest() matches the target itself and keeps walking up past the row, so it
  // can land on the row (clickableRowProps gives every row role="link" or
  // role="button") or on something around it (a row listed inside a dialog).
  // Those are the row's own context, not an element inside it — counting them
  // would cancel every click and keypress on the row.
  const isInsideRow = (match: Element | null) =>
    match !== null && !(row instanceof Node && match.contains(row));
  // [role="button"] only, not [role="link"] — a caller that doesn't pass `row`
  // would have every click inside a role="link" row match the row itself.
  if (isInsideRow(target.closest('a, button, input, textarea, select, label, [role="button"]'))) return true;
  // A dialog/menu/popover opened from inside a row is portaled elsewhere in the
  // DOM, but React still bubbles its events up through the component tree to the
  // row handler. Clicking any non-interactive area inside such an overlay (e.g.
  // the delivery-date section in the order-confirm dialog) must NOT navigate the
  // row — otherwise the dialog disappears mid-edit. Bail on any portaled surface.
  return isInsideRow(
    target.closest(
      '[role="dialog"], [role="alertdialog"], [role="menu"], [role="menuitem"], [role="listbox"], [data-radix-popper-content-wrapper]'
    )
  );
}

/**
 * Spread onto a `<tr>` or a mobile card `<div>` to make the whole row activate
 * `onActivate` on click or Enter/Space, while interactive elements inside it
 * (buttons, links, an opened dialog/menu) keep handling their own clicks — see
 * `shouldIgnoreRowNavigation`. A plain function, not a hook, on purpose: every
 * call site builds these props once per row inside a `.map()`, where calling a
 * hook would break the rules of hooks.
 */
export function clickableRowProps(
  onActivate: () => void,
  { role = "link" }: { role?: "link" | "button" } = {}
) {
  return {
    role,
    tabIndex: 0,
    onClick: (event: MouseEvent) => {
      if (shouldIgnoreRowNavigation(event.target, event.currentTarget)) return;
      onActivate();
    },
    onKeyDown: (event: KeyboardEvent) => {
      if (shouldIgnoreRowNavigation(event.target, event.currentTarget)) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      onActivate();
    },
  } as const;
}

/**
 * The common case of `clickableRowProps`: navigate to `href` via the app
 * router, kicking off the top nav-progress bar first (rows aren't real `<a>`
 * tags, so nothing else would trigger it). Pass the `router` from the calling
 * component's own `useRouter()` — this file has no "use client" directive and
 * stays importable from anywhere.
 *
 * Nothing is fetched ahead. Rows used to load their page on the server when
 * the mouse rested on them (project, order and customer rows); since those
 * pages are drawn from the device's copy, a click shows them at once and the
 * hover only cost the server 8–10 reads each time (review 2026-10-28; removed
 * 2026-10-29).
 */
export function rowNavigateProps(
  router: { push: (href: string) => void },
  href: string,
  options?: {
    role?: "link" | "button";
    /** Runs just before the navigation starts (e.g. to show a preview). */
    onNavigate?: () => void;
  }
) {
  return clickableRowProps(
    () => {
      options?.onNavigate?.();
      emitNavigationStart();
      router.push(href);
    },
    { role: options?.role }
  );
}

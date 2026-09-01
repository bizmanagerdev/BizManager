import type { KeyboardEvent, MouseEvent } from "react";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";

// Skip row-level navigation when the click/keydown originated on an interactive
// element inside the row (so per-row buttons/links still work as expected).
export function shouldIgnoreRowNavigation(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  // [role="button"] only, not [role="link"] — the clickable ROW ITSELF commonly
  // carries role="link" (see e.g. SalesOrdersClient.tsx), and target.closest()
  // matches an element against itself too, so including "link" here would make
  // every click inside such a row match its own wrapper and cancel ALL navigation.
  if (target.closest('a, button, input, textarea, select, label, [role="button"]')) return true;
  // A dialog/menu/popover opened from inside a row is portaled elsewhere in the
  // DOM, but React still bubbles its events up through the component tree to the
  // row handler. Clicking any non-interactive area inside such an overlay (e.g.
  // the delivery-date section in the order-confirm dialog) must NOT navigate the
  // row — otherwise the dialog disappears mid-edit. Bail on any portaled surface.
  return Boolean(
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
      if (shouldIgnoreRowNavigation(event.target)) return;
      onActivate();
    },
    onKeyDown: (event: KeyboardEvent) => {
      if (shouldIgnoreRowNavigation(event.target)) return;
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
 */
export function rowNavigateProps(
  router: { push: (href: string) => void },
  href: string,
  options?: { role?: "link" | "button" }
) {
  return clickableRowProps(() => {
    emitNavigationStart();
    router.push(href);
  }, options);
}

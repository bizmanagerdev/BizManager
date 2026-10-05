import type { KeyboardEvent, MouseEvent, PointerEvent } from "react";
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";

// How long the mouse has to rest on a row before its page is fetched ahead —
// long enough that sweeping across a list doesn't load every row it passes.
const HOVER_PREFETCH_DELAY_MS = 100;

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
  router: { push: (href: string) => void; prefetch?: (href: string, options?: { kind: PrefetchKind }) => void },
  href: string,
  options?: {
    role?: "link" | "button";
    /**
     * Start loading the row's page (data included) on intent rather than on
     * the click: after the mouse rests on the row briefly, the moment a finger
     * or button goes down, or on keyboard focus — so the page is mostly or
     * entirely in hand by the time the click lands. Opt-in: each prefetch is a
     * full server render of that page, so only lists whose rows lead to a
     * heavy, much-visited page use it.
     */
    prefetch?: boolean;
  }
) {
  const props = clickableRowProps(
    () => {
      emitNavigationStart();
      router.push(href);
    },
    { role: options?.role }
  );
  const prefetch = router.prefetch;
  if (!options?.prefetch || !prefetch) return props;

  const prefetchNow = () => prefetch(href, { kind: PrefetchKind.FULL });
  let hoverTimer: ReturnType<typeof setTimeout> | null = null;
  return {
    ...props,
    onPointerEnter: (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      hoverTimer = setTimeout(prefetchNow, HOVER_PREFETCH_DELAY_MS);
    },
    onPointerLeave: () => {
      if (hoverTimer) clearTimeout(hoverTimer);
      hoverTimer = null;
    },
    // Touch has no hover: the press itself is the earliest sign, ~100 ms
    // before the click it becomes.
    onPointerDown: prefetchNow,
    onFocus: prefetchNow,
  } as const;
}

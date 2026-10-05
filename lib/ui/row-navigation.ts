import type { FocusEvent, KeyboardEvent, MouseEvent, PointerEvent } from "react";
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";

// How long the mouse has to rest on a row before its page is fetched ahead —
// long enough that sweeping across a list doesn't load every row it passes.
const HOVER_PREFETCH_DELAY_MS = 100;

// Focus that came from the keyboard (Tab), not from the tap or click that
// focuses a row a moment before it activates it.
function isKeyboardFocus(element: Element) {
  try {
    return element.matches(":focus-visible");
  } catch {
    return false;
  }
}

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
 */
export function rowNavigateProps(
  router: { push: (href: string) => void; prefetch?: (href: string, options?: { kind: PrefetchKind }) => void },
  href: string,
  options?: {
    role?: "link" | "button";
    /**
     * Start loading the row's page (data included) on intent rather than on
     * the click: after the mouse rests on the row briefly, or when the
     * keyboard moves onto it — so the page is mostly or entirely in hand by
     * the time the click lands. Opt-in: each prefetch is a full server render
     * of that page, so only lists whose rows lead to a heavy, much-visited
     * page use it.
     *
     * Nothing on touch. A finger going down also starts every scroll through
     * the list, and the tap's own press or focus comes ~100 ms before its
     * click — too late for a prefetch to finish, and the router doesn't wait
     * for one still in flight: it sends its own request, so the page would be
     * rendered twice for no gain.
     */
    prefetch?: boolean;
    /** Runs just before the navigation starts (e.g. to show a preview). */
    onNavigate?: () => void;
  }
) {
  const props = clickableRowProps(
    () => {
      options?.onNavigate?.();
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
    onFocus: (event: FocusEvent) => {
      if (isKeyboardFocus(event.currentTarget)) prefetchNow();
    },
  } as const;
}

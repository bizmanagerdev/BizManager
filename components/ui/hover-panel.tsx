"use client";

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";

import { cn } from "@/lib/utils";

// A hover-to-peek panel whose trigger stays a real link/button.
//
// Why not DropdownMenu: a menu OWNS focus — Radix focuses its content on open,
// which is correct for a menu you clicked but wrong for a panel you merely
// hovered (it would swallow keystrokes from whatever you were typing in). Popover
// lets us decline the focus grab, so hovering previews without interrupting.
//
// Pair with useHoverPanel() below, which handles the trigger→panel pointer
// journey (the panel is portaled, so it needs its own hover handlers plus a
// small close delay for the gap between them).

export const HoverPanel = PopoverPrimitive.Root;
export const HoverPanelTrigger = PopoverPrimitive.Trigger;
export const HoverPanelAnchor = PopoverPrimitive.Anchor;

export const HoverPanelContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "end", sideOffset = 6, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      // It's a preview, not a destination: never steal focus on hover, and don't
      // yank it around on close either.
      onOpenAutoFocus={(e) => e.preventDefault()}
      onCloseAutoFocus={(e) => e.preventDefault()}
      className={cn(
        "z-50 min-w-[8rem] overflow-hidden rounded-2xl border border-border/60 bg-popover/95 p-1 text-popover-foreground shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2",
        className
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
HoverPanelContent.displayName = "HoverPanelContent";

/**
 * Open/close wiring for a hover panel. Spread `triggerProps` on the trigger and
 * `panelProps` on the content; both keep it open, and leaving either closes it
 * after a short grace period so the pointer can cross the gap between them.
 */
// Radix's own dismissable-layer can call onOpenChange(false) on its OWN
// internal "outside interaction" detection — independent of, and much
// faster than, hideSoon's delay. Root-caused via a real CI e2e run's
// captured stack trace: opening via hover (not Radix's expected click-to-
// open pattern) leaves Radix's outside-click detection nothing to
// distinguish "the same interaction that just opened this" from "a later,
// genuine outside click" — it can close the panel within ~50ms of it having
// just opened, before a click already in flight on something inside ever
// completes. A close request THIS soon after a hover-triggered open is, in
// practice, always that spurious case, not a real one.
const RADIX_CLOSE_GRACE_MS = 300;

export function useHoverPanel(delayMs = 180) {
  const [open, setOpenRaw] = React.useState(false);
  const lastShowAtRef = React.useRef(0);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = React.useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const show = React.useCallback(() => {
    cancel();
    lastShowAtRef.current = Date.now();
    setOpenRaw(true);
  }, [cancel]);
  const hideSoon = React.useCallback(() => {
    cancel();
    timer.current = setTimeout(() => setOpenRaw(false), delayMs);
  }, [cancel, delayMs]);

  React.useEffect(() => cancel, [cancel]);

  return {
    open,
    // Wired to Radix's own onOpenChange at every call site — applies the
    // spurious-close guard above. Internal closes (hide/hideSoon) call
    // setOpenRaw directly instead, since those are always legitimate and
    // must never be suppressed.
    setOpen: React.useCallback((next: boolean) => {
      if (!next && Date.now() - lastShowAtRef.current < RADIX_CLOSE_GRACE_MS) {
        // TEMPORARY DIAGNOSTIC — confirms this guard is the one actually
        // engaging, for the e2e run validating it. window.__e2ePush only
        // exists during that instrumented test; inert everywhere else.
        // Remove alongside e2e/admin-customer-create.spec.ts's own
        // temporary instrumentation once confirmed.
        (window as unknown as { __e2ePush?: (s: string) => void }).__e2ePush?.(
          `[GRACE-SUPPRESSED spurious close, ${Date.now() - lastShowAtRef.current}ms since show()]`
        );
        return;
      }
      setOpenRaw(next);
    }, []),
    show,
    hide: React.useCallback(() => {
      cancel();
      setOpenRaw(false);
    }, [cancel]),
    // onPointerDownCapture (not onClick — every call site already defines its
    // own, which would silently win the prop over mine in a spread) cancels
    // any pending hideSoon the instant a real interaction starts anywhere in
    // the trigger or panel, regardless of a mouseleave that fired moments
    // earlier crossing the gap between them. Root-caused via a real CI e2e
    // run's captured DOM evidence: a click that moves the pointer straight
    // from the trigger to a tile inside the panel can register mouseleave
    // (starting the 180ms close timer) before mouseenter on the panel
    // registers, especially under load — closing the panel out from under a
    // click already in flight. Capture phase fires before the click itself,
    // so this always wins the race regardless of that gap.
    triggerProps: { onMouseEnter: show, onMouseLeave: hideSoon, onFocus: show, onPointerDownCapture: cancel },
    panelProps: { onMouseEnter: show, onMouseLeave: hideSoon, onPointerDownCapture: cancel },
  };
}

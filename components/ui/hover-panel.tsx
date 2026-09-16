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
export function useHoverPanel(delayMs = 180) {
  const [open, setOpenRaw] = React.useState(false);
  // TEMPORARY DIAGNOSTIC — round 11 of an e2e investigation. Round 10 proved
  // (by patching setTimeout/clearTimeout) that hideSoon's own 180ms timer
  // never even gets scheduled for the specific removal being chased, yet the
  // panel still closes near-instantly — meaning something OTHER than
  // hideSoon is calling the raw `setOpen` this hook returns (every call site
  // wires it straight to Radix Popover's own onOpenChange, which fires for
  // Radix's OWN internal dismiss logic too, e.g. its "pointer down outside"
  // detection — completely bypassing hideSoon). Logs a stack trace on every
  // call so the real caller shows up directly. window.__e2ePush only exists
  // during the instrumented e2e test; guarded so this is inert everywhere
  // else. Remove once root-caused.
  const setOpen = React.useCallback((value: boolean | ((prev: boolean) => boolean)) => {
    const push = (window as unknown as { __e2ePush?: (s: string) => void }).__e2ePush;
    if (push) push(`[setOpen(${typeof value === "function" ? "fn" : value})] ${new Error().stack?.split("\n").slice(1, 5).join(" <- ") ?? ""}`);
    setOpenRaw(value);
  }, []);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = React.useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const show = React.useCallback(() => {
    cancel();
    setOpen(true);
  }, [cancel, setOpen]);
  const hideSoon = React.useCallback(() => {
    cancel();
    timer.current = setTimeout(() => setOpen(false), delayMs);
  }, [cancel, delayMs, setOpen]);

  React.useEffect(() => cancel, [cancel]);

  return {
    open,
    setOpen,
    show,
    hide: React.useCallback(() => {
      cancel();
      setOpen(false);
    }, [cancel, setOpen]),
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

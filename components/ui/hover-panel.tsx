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
  const [open, setOpen] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = React.useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const show = React.useCallback(() => {
    cancel();
    setOpen(true);
  }, [cancel]);
  const hideSoon = React.useCallback(() => {
    cancel();
    timer.current = setTimeout(() => setOpen(false), delayMs);
  }, [cancel, delayMs]);

  React.useEffect(() => cancel, [cancel]);

  return {
    open,
    setOpen,
    show,
    hide: React.useCallback(() => {
      cancel();
      setOpen(false);
    }, [cancel]),
    triggerProps: { onMouseEnter: show, onMouseLeave: hideSoon, onFocus: show },
    panelProps: { onMouseEnter: show, onMouseLeave: hideSoon },
  };
}

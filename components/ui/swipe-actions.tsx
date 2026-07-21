"use client";

// A row you can swipe sideways to reveal its actions — the mobile pattern that
// replaces a stack of buttons under every card. The card stays compact; the
// actions live underneath it and only appear when asked for.
//
// RTL geometry (this app is RTL-only): the action strip is pinned to the LEFT
// edge, which is the END of the line in Hebrew. To uncover something sitting at
// the left, the card has to travel RIGHT — so the opening gesture is a drag
// toward the right, and `translateX` is positive.
//
// Two details that make it feel native rather than janky:
//   * The gesture stays undecided until the pointer has moved ~10px, then locks
//     to horizontal OR vertical. Without that lock, a diagonal thumb-flick while
//     scrolling the list would peel cards open behind you.
//   * `touch-action: pan-y` tells the browser we handle horizontal ourselves but
//     it keeps owning vertical scroll, so the list never feels sticky.

import { useCallback, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type SwipeAction = {
  key: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  /** Background + text classes for the action tile. */
  className?: string;
};

const ACTION_WIDTH = 76; // px per action tile
/** Past this fraction of the strip, releasing snaps OPEN instead of closed. */
const OPEN_THRESHOLD = 0.4;
/** Movement before we commit to "this is a horizontal swipe". */
const DIRECTION_LOCK = 10;

export function SwipeActions({
  actions,
  children,
  className,
  onOpenChange,
  open,
}: {
  actions: SwipeAction[];
  children: ReactNode;
  className?: string;
  /** Controlled open state — lets a list keep only one row open at a time. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const stripWidth = actions.length * ACTION_WIDTH;

  const [dragOffset, setDragOffset] = useState<number | null>(null);
  const startX = useRef(0);
  const startY = useRef(0);
  // null = undecided, true = horizontal (ours), false = vertical (the list's)
  const axis = useRef<boolean | null>(null);
  const openedAtStart = useRef(false);

  const isOpen = open ?? false;
  const resting = isOpen ? stripWidth : 0;
  const offset = dragOffset ?? resting;

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      startX.current = event.clientX;
      startY.current = event.clientY;
      axis.current = null;
      openedAtStart.current = isOpen;
    },
    [isOpen]
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (axis.current === false) return;
      const dx = event.clientX - startX.current;
      const dy = event.clientY - startY.current;

      if (axis.current === null) {
        if (Math.abs(dx) < DIRECTION_LOCK && Math.abs(dy) < DIRECTION_LOCK) return;
        axis.current = Math.abs(dx) > Math.abs(dy);
        if (!axis.current) return;
      }

      // Clamp into [0, stripWidth] so the card can't be dragged past its stops.
      const next = Math.max(0, Math.min(stripWidth, (openedAtStart.current ? stripWidth : 0) + dx));
      setDragOffset(next);
    },
    [stripWidth]
  );

  const endDrag = useCallback(() => {
    if (axis.current === true && dragOffset !== null) {
      onOpenChange?.(dragOffset > stripWidth * OPEN_THRESHOLD);
    }
    axis.current = null;
    setDragOffset(null);
  }, [dragOffset, onOpenChange, stripWidth]);

  return (
    <div className={cn("relative min-w-0 overflow-hidden rounded-2xl", className)}>
      {/* The strip sits UNDER the card, pinned to the left (RTL end) edge. */}
      <div className="absolute inset-y-0 left-0 flex" style={{ width: stripWidth }} aria-hidden={!isOpen}>
        {actions.map((action) => (
          <button
            key={action.key}
            type="button"
            tabIndex={isOpen ? 0 : -1}
            onClick={() => {
              onOpenChange?.(false);
              action.onSelect();
            }}
            className={cn(
              "flex h-full flex-col items-center justify-center gap-1 text-[11px] font-semibold text-white transition-opacity",
              action.className ?? "bg-secondary"
            )}
            style={{ width: ACTION_WIDTH }}
          >
            {action.icon}
            <span className="px-1 text-center leading-tight">{action.label}</span>
          </button>
        ))}
      </div>

      <div
        className="relative touch-pan-y bg-card"
        style={{
          transform: `translateX(${offset}px)`,
          // Animate the snap, but follow the finger 1:1 while dragging.
          transition: dragOffset === null ? "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)" : "none",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        // An open row swallows the next tap to close itself, so a stray tap can
        // never fire the action underneath.
        onClickCapture={(event) => {
          if (isOpen) {
            event.preventDefault();
            event.stopPropagation();
            onOpenChange?.(false);
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}

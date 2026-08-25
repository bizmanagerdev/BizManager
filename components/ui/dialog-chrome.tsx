"use client";

// The three bars every dialog in the app is built from. FormDialog, ViewDialog
// and StepWizard all render THESE — so a padding, a border or the position of
// the close X can only be changed in one place, and a wizard can't drift away
// from an edit dialog again.

import { useRef, type ReactNode, type Ref, type TouchEvent as ReactTouchEvent } from "react";
import { CloseIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

/** The className every dialog passes to AdaptiveDialog: a fixed-height column
 *  whose middle section is the only thing that scrolls. */
export const DIALOG_CHROME_CONTENT =
  "flex max-h-[92svh] flex-col gap-0 overflow-y-hidden p-0 sm:p-0";

/** Same shape, for a full-page dialog (AdaptivePageDialog). No explicit
 *  height on mobile — FullScreenDialogContent's `inset-0` already stretches
 *  the box to the viewport via top+bottom, which tracks the on-screen
 *  keyboard more reliably than any `dvh` unit does across browsers; setting
 *  a height here would override that stretch instead of matching it. Only
 *  the sm+ box (which drops inset-0 for centered positioning) needs an
 *  explicit cap. */
export const DIALOG_CHROME_CONTENT_PAGE =
  "flex flex-col gap-0 overflow-y-hidden p-0 sm:max-h-[90vh] sm:p-0";

/** Drag distance (px) past which a full-page dialog's swipe-down counts as
 *  "dismiss it" rather than a stray touch — bigger than the quick-create FAB
 *  panel's 72px since a full page gives far more surface to graze by accident. */
export const FULL_SCREEN_DISMISS_THRESHOLD = 120;

/**
 * Swipe-down-to-close for a full-page mobile dialog. Shared by FormDialog,
 * StepWizardDialog and any bespoke dialog (TaskUpsertDialog, the order/project
 * wizard hosts in QuickCreateDialogs.tsx) that builds its own chrome instead
 * of going through one of those — three sites doing this by hand was the
 * threshold for pulling it out.
 *
 * Deliberately NOT React state for the drag distance: driving the translateY
 * through a re-render on every touchmove was the cause of a visible "jump" on
 * a form with a lot of fields (a fresh render can't keep up with 60fps of
 * touch events). Mutate the dragged element's style directly instead — grabbed
 * via `event.currentTarget` on touchstart, which is reliable via React's
 * synthetic-event delegation regardless of what descendant the touch actually
 * started on. Gated on the body being scrolled to the top so it never fights
 * a normal scroll (same trick the quick-create FAB panel's phone sheet uses).
 */
export function useSwipeToDismiss({
  enabled,
  bodyRef,
  onDismiss,
}: {
  enabled: boolean;
  /** The scrollable body — read-only here, just to gate the drag start. */
  bodyRef: { current: HTMLElement | null };
  onDismiss: () => void;
}) {
  const dragStartY = useRef<number | null>(null);
  const dragDistanceRef = useRef(0);
  const dragNodeRef = useRef<HTMLElement | null>(null);

  function resetDragStyle() {
    const node = dragNodeRef.current;
    if (node) {
      node.style.transition = "transform 150ms ease-out";
      node.style.transform = "";
    }
    dragNodeRef.current = null;
  }

  if (!enabled) return {};

  return {
    onTouchStart: (event: ReactTouchEvent) => {
      if ((bodyRef.current?.scrollTop ?? 0) > 0) return;
      dragStartY.current = event.touches[0]?.clientY ?? null;
      dragNodeRef.current = event.currentTarget as HTMLElement;
    },
    onTouchMove: (event: ReactTouchEvent) => {
      if (dragStartY.current === null) return;
      const delta = (event.touches[0]?.clientY ?? 0) - dragStartY.current;
      const next = delta > 0 ? delta : 0;
      dragDistanceRef.current = next;
      const node = dragNodeRef.current;
      if (node) {
        node.style.transition = "none";
        node.style.transform = next ? `translateY(${next}px)` : "";
      }
    },
    onTouchEnd: () => {
      const shouldClose = dragDistanceRef.current > FULL_SCREEN_DISMISS_THRESHOLD;
      dragStartY.current = null;
      dragDistanceRef.current = 0;
      resetDragStyle();
      if (shouldClose) onDismiss();
    },
    onTouchCancel: () => {
      dragStartY.current = null;
      dragDistanceRef.current = 0;
      resetDragStyle();
    },
  };
}

/**
 * Pinned top bar. `children` is the title block (or a stepper); the X lives
 * here rather than floating in the corner, so it lines up with the title and
 * sits in the same place whether the dialog is a form, a view or a wizard.
 */
export function DialogChromeHeader({
  children,
  onClose,
  closeDisabled = false,
  closeLabel = "סגירה",
  end,
  below,
  className,
  grabber = false,
}: {
  children: ReactNode;
  onClose?: () => void;
  closeDisabled?: boolean;
  closeLabel?: string;
  /** Small controls beside the title (a status chip, a link out). */
  end?: ReactNode;
  /** Pinned under the title — a search field, filters. */
  below?: ReactNode;
  className?: string;
  /** A full-page mobile dialog's swipe-down affordance — decorative, the whole
   *  header is the drag surface. Hidden again at sm (the desktop box doesn't
   *  swipe). */
  grabber?: boolean;
}) {
  return (
    <div
      className={cn(
        "shrink-0 space-y-3 border-b border-border/70 bg-background px-4 py-3 sm:px-6",
        className
      )}
    >
      {grabber ? (
        <div className="mx-auto -mt-1 mb-1 h-1 w-10 rounded-full bg-muted-foreground/30 sm:hidden" aria-hidden />
      ) : null}
      <div className="flex items-start gap-3">
        {/* overflow-hidden so a wide header (a 4-step stepper on a phone) can't
            push the X off the edge or force the dialog to scroll sideways. */}
        <div className="min-w-0 flex-1 overflow-hidden">{children}</div>
        {end ? <div className="shrink-0">{end}</div> : null}
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            disabled={closeDisabled}
            aria-label={closeLabel}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        ) : null}
      </div>
      {below}
    </div>
  );
}

/** The only scrolling area, so the bars above and below it stay put. */
export function DialogChromeBody({
  children,
  ref,
  className,
}: {
  children: ReactNode;
  ref?: Ref<HTMLDivElement>;
  className?: string;
}) {
  return (
    <div
      ref={ref}
      className={cn("min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6", className)}
    >
      {children}
    </div>
  );
}

/** Pinned action bar. */
export function DialogChromeFooter({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "shrink-0 space-y-2 border-t border-border/70 bg-background px-4 py-3 sm:px-6",
        className
      )}
    >
      {children}
    </div>
  );
}

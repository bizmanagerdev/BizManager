"use client";

// The three bars every dialog in the app is built from. FormDialog, ViewDialog
// and StepWizard all render THESE — so a padding, a border or the position of
// the close X can only be changed in one place, and a wizard can't drift away
// from an edit dialog again.

import type { ReactNode, Ref } from "react";
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
          <>
            {/* A rule before the X: beside a numbered stepper the bare icon reads
                as one more step circle. */}
            <div className="h-7 w-px shrink-0 self-start bg-border/70" />
            <button
              type="button"
              onClick={onClose}
              disabled={closeDisabled}
              aria-label={closeLabel}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            >
              <CloseIcon className="h-5 w-5" />
            </button>
          </>
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

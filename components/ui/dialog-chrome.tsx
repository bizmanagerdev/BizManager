"use client";

// The three bars every dialog in the app is built from. FormDialog, ViewDialog
// and StepWizard all render THESE — so a padding, a border or the position of
// the close X can only be changed in one place, and a wizard can't drift away
// from an edit dialog again.

import type { ReactNode, Ref } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/** The className every dialog passes to AdaptiveDialog: a fixed-height column
 *  whose middle section is the only thing that scrolls. */
export const DIALOG_CHROME_CONTENT =
  "flex max-h-[92svh] flex-col gap-0 overflow-y-hidden p-0 sm:p-0";

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
}) {
  return (
    <div
      className={cn(
        "shrink-0 space-y-3 border-b border-border/70 bg-background px-4 py-3 sm:px-6",
        className
      )}
    >
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
              <X className="h-5 w-5" />
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

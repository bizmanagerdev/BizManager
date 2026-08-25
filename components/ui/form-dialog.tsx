"use client";

// THE form dialog — every create/edit dialog in the app is this component with
// different fields inside. It fixes two things the 65 hand-built copies kept
// getting differently:
//
// 1. Layout. The title and the action bar are pinned; only the fields scroll.
//    Half the old dialogs let the whole box scroll instead, which on a phone
//    pushed the save button below the fold on any long form.
// 2. The action bar. One primary button, one place, one busy state — instead of
//    nine different footer spacings (mt-6, mt-4, mt-2, border-t pt-4, …).
//
// There is no cancel button: the dialog's X closes it, and two ways out
// crowded the bar next to the action that matters. Pass showCancel for the rare
// flow where walking away needs to be as loud as saving.

import { useRef, useState, type ReactNode } from "react";
import type { TouchEvent as ReactTouchEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DIALOG_CHROME_CONTENT,
  DIALOG_CHROME_CONTENT_PAGE,
  DialogChromeBody,
  DialogChromeFooter,
  DialogChromeHeader,
} from "@/components/ui/dialog-chrome";
import { AdaptiveDialog, AdaptivePageDialog, dialogVariants } from "@/components/layout/page-layout";
import { cn } from "@/lib/utils";

// A full page needs a bigger drag before it counts as "throw this away" than a
// small popover would — there's much more room to graze the header by accident.
const FULL_SCREEN_DISMISS_THRESHOLD = 120;

export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  size = "formLg",
  onSubmit,
  submitLabel,
  /** Shown on the submit button while busy — defaults to submitLabel. */
  busyLabel,
  submitDisabled = false,
  /** Saving/uploading: disables the fields and the submit, and blocks closing. */
  busy = false,
  error,
  /** Extra content at the start of the action bar — a delete button, a hint. */
  footerStart,
  showCancel = false,
  cancelLabel = "ביטול",
  className,
  bodyClassName,
  /** Render as a full mobile page (swipe down or X to close) instead of a
   *  centered box — desktop is unchanged either way. Opt in per dialog while
   *  this rolls out; see components/financial/IncomeDialog.tsx for the first. */
  fullScreen = false,
  children,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  title: string;
  description?: string;
  size?: keyof typeof dialogVariants;
  onSubmit: () => void;
  submitLabel: string;
  busyLabel?: string;
  submitDisabled?: boolean;
  busy?: boolean;
  error?: string;
  footerStart?: ReactNode;
  showCancel?: boolean;
  cancelLabel?: string;
  className?: string;
  bodyClassName?: string;
  fullScreen?: boolean;
  children: ReactNode;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  // Swipe-down-to-close on the full-page mobile layout: how far it's been
  // dragged, and where the finger started. Only counts as a drag when it
  // begins with the body scrolled to the top, so it never fights a scroll —
  // same gating QuickCreateMenu's phone sheet uses.
  const [dragY, setDragY] = useState(0);
  const dragStartY = useRef<number | null>(null);

  function handleOpenChange(next: boolean) {
    // Never vanish mid-save — the user would have no idea whether it landed.
    if (!next && busy) return;
    onOpenChange(next);
  }

  const swipeProps = fullScreen
    ? {
        onTouchStart: (event: ReactTouchEvent) => {
          if ((bodyRef.current?.scrollTop ?? 0) > 0) return;
          dragStartY.current = event.touches[0]?.clientY ?? null;
        },
        onTouchMove: (event: ReactTouchEvent) => {
          if (dragStartY.current === null) return;
          const delta = (event.touches[0]?.clientY ?? 0) - dragStartY.current;
          setDragY(delta > 0 ? delta : 0);
        },
        onTouchEnd: () => {
          if (dragY > FULL_SCREEN_DISMISS_THRESHOLD) handleOpenChange(false);
          dragStartY.current = null;
          setDragY(0);
        },
        onTouchCancel: () => {
          dragStartY.current = null;
          setDragY(0);
        },
      }
    : {};

  const content = (
    <>
      <DialogChromeHeader onClose={() => handleOpenChange(false)} closeDisabled={busy} grabber={fullScreen}>
        <DialogHeader className="space-y-1 text-start">
          <DialogTitle>{title}</DialogTitle>
          {/* Always rendered: Radix warns without a description, and screen
              readers announce the dialog's purpose from it. */}
          <DialogDescription className={cn("text-xs", !description && "sr-only")}>
            {description ?? title}
          </DialogDescription>
        </DialogHeader>
      </DialogChromeHeader>

      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <DialogChromeBody ref={bodyRef} className={bodyClassName}>
          {/* display:contents so disabling every field costs no layout. */}
          <fieldset disabled={busy} className="contents">
            {children}
          </fieldset>
        </DialogChromeBody>

        <DialogChromeFooter>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex flex-wrap items-center gap-2">
            {/* Always present, so the primary action stays at the end of the
                bar whether or not the caller put anything at the start. */}
            <div className="me-auto flex items-center gap-2">{footerStart}</div>
            {showCancel ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => onOpenChange(false)}
                disabled={busy}
              >
                {cancelLabel}
              </Button>
            ) : null}
            <Button type="submit" disabled={busy || submitDisabled} className="min-w-0 shrink-0">
              {busy ? (busyLabel ?? submitLabel) : submitLabel}
            </Button>
          </div>
        </DialogChromeFooter>
      </form>
    </>
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {/* hideClose: the chrome header carries the only X. */}
      {fullScreen ? (
        <AdaptivePageDialog
          size={size}
          hideClose
          className={cn(DIALOG_CHROME_CONTENT_PAGE, className)}
          style={{
            transform: dragY ? `translateY(${dragY}px)` : undefined,
            transition: dragY ? "none" : "transform 150ms ease-out",
          }}
          {...swipeProps}
        >
          {content}
        </AdaptivePageDialog>
      ) : (
        <AdaptiveDialog size={size} hideClose className={cn(DIALOG_CHROME_CONTENT, className)}>
          {content}
        </AdaptiveDialog>
      )}
    </Dialog>
  );
}

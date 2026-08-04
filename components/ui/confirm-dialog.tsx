"use client";

// THE "are you sure?" dialog. Unlike FormDialog, this one keeps both buttons:
// a question genuinely has two answers, and the safe one has to be as easy to
// reach as the destructive one.
//
// `children` is for context the question needs — the row being deleted, what
// else it will affect. Keep it short; if it grows fields, it's a FormDialog.

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  /** Context for the question — a summary of the row, a warning. */
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style the confirm button as destructive (red). Default: false. */
  destructive?: boolean;
  /** While true, buttons are disabled and the confirm shows a busy label. */
  loading?: boolean;
  /** Shown above the buttons when the action failed. */
  error?: string;
  onConfirm: () => void;
};

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel = "אישור",
  cancelLabel = "ביטול",
  destructive = false,
  loading = false,
  error,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Never vanish mid-action — the user wouldn't know if it happened.
        if (loading) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="space-y-1 text-start">
          <DialogTitle>{title}</DialogTitle>
          {/* Always rendered: Radix warns without one, and it's what a screen
              reader announces as the question. */}
          <DialogDescription className={description ? undefined : "sr-only"}>
            {description ?? title}
          </DialogDescription>
        </DialogHeader>

        {children}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <DialogFooter className="mt-2">
          <Button type="button" variant="secondary" disabled={loading} onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={destructive ? "destructive" : "default"}
            disabled={loading}
            onClick={onConfirm}
          >
            {loading ? "..." : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

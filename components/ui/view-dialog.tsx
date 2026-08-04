"use client";

// The read-only sibling of FormDialog: a preview, a details panel, a receipt.
// Same chrome, same pinned title, same scrolling body — but no action bar,
// because there is nothing to save. A footer here could only hold a close
// button, which is the X in the header a second time.
//
// If a "dialog" grows a real action, it isn't a view any more — move it to
// FormDialog and give the action a proper place in the bar.

import type { ReactNode } from "react";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DIALOG_CHROME_CONTENT,
  DialogChromeBody,
  DialogChromeFooter,
  DialogChromeHeader,
} from "@/components/ui/dialog-chrome";
import { AdaptiveDialog, dialogVariants } from "@/components/layout/page-layout";
import { cn } from "@/lib/utils";

export function ViewDialog({
  open,
  onOpenChange,
  title,
  description,
  size = "formLg",
  /** Small controls that belong beside the title (a status chip, a link out). */
  headerEnd,
  /** Pinned under the title — a search field, filters: things that must not
   *  scroll away with the content they control. */
  headerBelow,
  /** Optional pinned bar at the bottom — only for a real action, never for "close". */
  footer,
  className,
  bodyClassName,
  children,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  title: string;
  description?: string;
  size?: keyof typeof dialogVariants;
  headerEnd?: ReactNode;
  headerBelow?: ReactNode;
  footer?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* hideClose: the chrome header carries the only X. */}
      <AdaptiveDialog size={size} hideClose className={cn(DIALOG_CHROME_CONTENT, className)}>
        <DialogChromeHeader
          onClose={() => onOpenChange(false)}
          end={headerEnd}
          below={headerBelow}
        >
          <DialogHeader className="space-y-1 text-start">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className={description ? undefined : "sr-only"}>
              {description ?? title}
            </DialogDescription>
          </DialogHeader>
        </DialogChromeHeader>

        <DialogChromeBody className={bodyClassName}>{children}</DialogChromeBody>

        {footer ? <DialogChromeFooter>{footer}</DialogChromeFooter> : null}
      </AdaptiveDialog>
    </Dialog>
  );
}

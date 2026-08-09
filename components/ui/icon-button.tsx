"use client";

// Icon-only buttons, so that a repeated action looks the same on every screen.
//
// The rule this file encodes: an action that appears over and over in lists and
// rows — edit above all — is a GLYPH, never a glyph plus a word. Rows stay
// scannable, nothing wraps, and the Hebrew label survives as `aria-label` +
// `title` so screen readers and hover tooltips still name the action.

import * as React from "react";

import { Button, type ButtonProps } from "@/components/ui/button";
import { DeleteIcon, EditIcon, type IconComponent } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

export interface IconButtonProps extends Omit<ButtonProps, "children" | "size"> {
  /** Always from the palette — see components/ui/icons.ts. */
  icon: IconComponent;
  /** Hebrew. Required: it is the button's ONLY name, for hover and for a11y. */
  label: string;
  /** `sm` (h-9) suits table rows and card headers; `default` (h-11) toolbars. */
  size?: "sm" | "default";
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon: Icon, label, size = "sm", variant = "secondary", className, ...props }, ref) => (
    <Button
      ref={ref}
      type="button"
      variant={variant}
      size={size === "sm" ? "icon-sm" : "icon"}
      aria-label={label}
      title={label}
      className={cn("shrink-0", className)}
      {...props}
    >
      {/* Button already sizes any nested svg to 4 units. */}
      <Icon />
    </Button>
  )
);
IconButton.displayName = "IconButton";

/** The icon is fixed; only the tooltip wording is the caller's to choose. */
type FixedIconButtonProps = Omit<IconButtonProps, "icon" | "label"> & { label?: string };

/**
 * THE edit control for the whole app: a pencil, no text, everywhere.
 * Pass `label` only to say WHAT is being edited ("עריכת לקוח") — it changes the
 * tooltip, never the pencil.
 */
export const EditButton = React.forwardRef<HTMLButtonElement, FixedIconButtonProps>(
  ({ label = "עריכה", ...props }, ref) => (
    <IconButton ref={ref} icon={EditIcon} label={label} {...props} />
  )
);
EditButton.displayName = "EditButton";

/** Delete's counterpart. Wrap it in `ConfirmDialog` — it asks nothing itself. */
export const DeleteButton = React.forwardRef<HTMLButtonElement, FixedIconButtonProps>(
  ({ label = "מחיקה", variant = "destructive", ...props }, ref) => (
    <IconButton ref={ref} icon={DeleteIcon} label={label} variant={variant} {...props} />
  )
);
DeleteButton.displayName = "DeleteButton";

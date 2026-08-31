"use client";

// Icon-only buttons, so that a repeated action looks the same on every screen.
//
// The rule this file encodes: an action that appears over and over in lists and
// rows — edit and delete above all — is a GLYPH, never a glyph plus a word. Rows
// stay scannable, nothing wraps, and the Hebrew label survives as `aria-label` +
// `title` so screen readers and hover tooltips still name the action.
//
// Edit and delete share the same look: an OUTLINED glyph — a colored border on
// the page's own background, never a filled or tinted slab. This is a
// deliberate, explicit exception to the app's general "buttons wear a solid
// fill" rule (components/ui/button.tsx's own comment) — the owner asked for
// these two specifically to stay outline regardless (2026-08-31). See
// `EditButton`/`DeleteButton` below.

import * as React from "react";

import { Button, type ButtonProps } from "@/components/ui/button";
import { DeleteIcon, EditIcon, SpinnerIcon, type IconComponent } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

export interface IconButtonProps extends Omit<ButtonProps, "children" | "size"> {
  /** Always from the palette — see components/ui/icons.ts. */
  icon: IconComponent;
  /** Hebrew. Required: it is the button's ONLY name, for hover and for a11y. */
  label: string;
  /** `sm` (h-9) suits table rows and card headers; `default` (h-11) toolbars. */
  size?: "sm" | "default";
  /** Swaps the glyph for a spinner and blocks the click while work is in flight. */
  loading?: boolean;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon: Icon, label, size = "sm", variant = "secondary", loading, disabled, className, ...props }, ref) => (
    <Button
      ref={ref}
      type="button"
      variant={variant}
      size={size === "sm" ? "icon-sm" : "icon"}
      aria-label={label}
      title={label}
      disabled={disabled || loading}
      className={cn("shrink-0", className)}
      {...props}
    >
      {/* Button already sizes any nested svg to 4 units. */}
      {loading ? <SpinnerIcon className="animate-spin" /> : <Icon />}
    </Button>
  )
);
IconButton.displayName = "IconButton";

/** The icon is fixed; only the tooltip wording is the caller's to choose. */
type FixedIconButtonProps = Omit<IconButtonProps, "icon" | "label"> & { label?: string };

/**
 * THE edit control for the whole app: a square, secondary-OUTLINED pencil
 * glyph, no text, everywhere. Pass `label` only to say WHAT is being edited
 * ("עריכת לקוח") — it changes the tooltip, never the pencil.
 *
 * Outline only, same construction as `DeleteButton` below (just the app's
 * secondary blue instead of destructive red) — a border on the page's own
 * background, no filled or tinted slab.
 */
export const EditButton = React.forwardRef<HTMLButtonElement, FixedIconButtonProps>(
  ({ label = "עריכה", className, ...props }, ref) => (
    <IconButton
      ref={ref}
      icon={EditIcon}
      label={label}
      // `ghost` as the base for the same reason as DeleteButton: it brings no
      // border/background of its own to fight with the outline below.
      variant="ghost"
      className={cn(
        "border-secondary bg-transparent text-secondary shadow-none hover:bg-secondary/10 hover:text-secondary",
        className
      )}
      {...props}
    />
  )
);
EditButton.displayName = "EditButton";

/**
 * THE delete control for the whole app: a square, red-OUTLINED trash glyph.
 * Outline only — a red BORDER on the page's own background, no tinted fill and
 * no solid red slab. It never carries a word; the Hebrew label lives in the
 * `title` tooltip (and `aria-label`), so the button's size never changes.
 *
 * Wrap it in `ConfirmDialog` — it asks nothing itself. The dialog's own confirm
 * button keeps its word; that one is a decision, not a row action.
 */
export const DeleteButton = React.forwardRef<HTMLButtonElement, FixedIconButtonProps>(
  ({ label = "מחיקה", className, ...props }, ref) => (
    <IconButton
      ref={ref}
      icon={DeleteIcon}
      label={label}
      // `ghost` as the base because it brings no border/background of its own to
      // fight with — the red outline below is the whole look.
      variant="ghost"
      className={cn(
        "border-destructive bg-transparent text-destructive shadow-none hover:bg-destructive/10 hover:text-destructive",
        className
      )}
      {...props}
    />
  )
);
DeleteButton.displayName = "DeleteButton";

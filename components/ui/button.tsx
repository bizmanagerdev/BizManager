import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";
import { STATUS_PILL_CLASSES } from "@/lib/ui/status-color-classes";

// NEVER put a margin on an icon inside a Button. `gap-2` below already spaces
// the glyph from the words, symmetrically and direction-aware; a `me-1` on top
// of it double-spaces one side, so the content stops sitting centred in its
// padding — and a PHYSICAL `ml-1`/`mr-1` in this RTL app puts the space on the
// far side of the glyph entirely. Swept out of 13 files on 2026-08-19.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-transparent text-sm font-medium ring-offset-background transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // Buttons wear SECONDARY (the sky blue) — that is what secondary is FOR.
        // Primary is the dark navy of text and chrome and is never a button fill.
        default:
          "bg-secondary text-secondary-foreground shadow-md shadow-secondary/20 hover:bg-secondary/90 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-secondary/25",
        destructive:
          "bg-destructive text-destructive-foreground shadow-md shadow-destructive/20 hover:bg-destructive/90 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-destructive/25",
        outline:
          "border-secondary/30 bg-background text-secondary shadow-sm hover:bg-secondary/5 hover:border-secondary/50 hover:-translate-y-0.5",
        secondary:
          "bg-secondary text-secondary-foreground shadow-md shadow-secondary/20 hover:bg-secondary/90 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-secondary/25",
        ghost:
          "text-secondary hover:bg-secondary/10",
        link: "text-secondary underline-offset-4 hover:underline",
        success:
          "bg-success text-success-foreground shadow-md shadow-success/20 hover:bg-success/90 hover:-translate-y-0.5",
        /* Soft "outline" variants — base colors come from STATUS_PILL_CLASSES (same source as
           the status badges); the button only adds interaction (shadow/hover). */
        "success-outline": `${STATUS_PILL_CLASSES.success} shadow-sm hover:bg-success/20 hover:-translate-y-0.5`,
        "destructive-outline": `${STATUS_PILL_CLASSES.danger} shadow-sm hover:bg-destructive/20 hover:-translate-y-0.5`,
      },
      size: {
        default: "h-11 px-4 py-2",
        sm: "h-9 px-3",
        lg: "h-12 px-8 text-base",
        icon: "h-11 w-11",
        "icon-sm": "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { buttonVariants };

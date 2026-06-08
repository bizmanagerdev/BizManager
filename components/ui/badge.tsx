import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";
import { STATUS_PILL_CLASSES } from "@/lib/ui/status-color-classes";

const badgeVariants = cva(
  "inline-flex w-fit items-center whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground shadow-sm shadow-primary/25",
        secondary: "border-transparent bg-secondary text-secondary-foreground shadow-sm shadow-secondary/25",
        outline: "border-border bg-background/70 text-foreground",

        /* Status variants — ALL derive from STATUS_PILL_CLASSES (the single source of
           truth in lib/ui/status-color-classes.ts), so every status pill stays consistent.
           Soft outline everywhere; the -soft / -outline aliases map to the same styles. */
        success: STATUS_PILL_CLASSES.success,
        warning: STATUS_PILL_CLASSES.warning,
        info: STATUS_PILL_CLASSES.info,
        destructive: STATUS_PILL_CLASSES.danger,
        neutral: STATUS_PILL_CLASSES.neutral,

        "success-soft": STATUS_PILL_CLASSES.success,
        "warning-soft": STATUS_PILL_CLASSES.warning,
        "info-soft": STATUS_PILL_CLASSES.info,
        "destructive-soft": STATUS_PILL_CLASSES.danger,
        "neutral-soft": STATUS_PILL_CLASSES.neutral,
        "success-outline": STATUS_PILL_CLASSES.success,
        "destructive-outline": STATUS_PILL_CLASSES.danger,
        "warning-outline": STATUS_PILL_CLASSES.warning,
        "info-outline": STATUS_PILL_CLASSES.info,
        "neutral-outline": STATUS_PILL_CLASSES.neutral,
      },
    },
    defaultVariants: {
      variant: "secondary",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { badgeVariants };

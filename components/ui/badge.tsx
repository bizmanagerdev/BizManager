import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex w-fit items-center whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground shadow-sm shadow-primary/25",
        secondary: "border-transparent bg-secondary text-secondary-foreground shadow-sm shadow-secondary/25",
        outline: "border-border bg-background/70 text-foreground",

        /* Solid status variants — dark colored bg + white text (use for emphasis) */
        success: "border-transparent bg-success text-success-foreground",
        warning: "border-transparent bg-warning text-warning-foreground",
        info: "border-transparent bg-info text-info-foreground",
        destructive: "border-transparent bg-destructive text-destructive-foreground",
        neutral: "border-transparent bg-primary-4 text-white",

        /* Soft pill variants — light tinted bg + dark colored text + colored border (default for status badges) */
        "success-soft": "border-success bg-success-soft text-success-soft-foreground",
        "warning-soft": "border-warning bg-warning-soft text-warning-soft-foreground",
        "info-soft": "border-info bg-info-soft text-info-soft-foreground",
        "destructive-soft": "border-destructive bg-destructive-soft text-destructive-soft-foreground",
        "neutral-soft": "border-border bg-muted text-muted-foreground",
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

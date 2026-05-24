import type { StatusColor } from "@/lib/ui/status-colors";

/**
 * Bold solid status pill classes — solid colored bg + high-contrast text,
 * no border. White text on green/red/blue (passes contrast); dark navy text
 * on yellow (only readable option for warning).
 */
export function getStatusColorClasses(color: StatusColor) {
  return {
    success: "bg-success text-success-foreground border-transparent",
    warning: "bg-warning text-warning-foreground border-transparent",
    danger: "bg-destructive text-destructive-foreground border-transparent",
    info: "bg-info text-info-foreground border-transparent",
    neutral: "bg-background text-muted-foreground border border-border",
  }[color];
}

export function getStatusDotClasses(color: StatusColor) {
  return {
    success: "bg-success",
    warning: "bg-warning",
    danger: "bg-destructive",
    info: "bg-info",
    neutral: "bg-muted-foreground/60",
  }[color];
}

export function getStatusBorderClasses(color: StatusColor) {
  return {
    success: "border-success",
    warning: "border-warning",
    danger: "border-destructive",
    info: "border-info",
    neutral: "border-border",
  }[color];
}

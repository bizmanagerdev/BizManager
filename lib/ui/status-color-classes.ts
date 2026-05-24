import type { StatusColor } from "@/lib/ui/status-colors";

/**
 * Status pill classes — soft style: light tinted background, colored border,
 * dark colored text. Same family per status, so the meaning reads at a glance
 * while the badge stays readable on white surfaces.
 */
export function getStatusColorClasses(color: StatusColor) {
  return {
    success: "bg-success-soft text-success-soft-foreground border-success",
    warning: "bg-warning-soft text-warning-soft-foreground border-warning",
    danger: "bg-destructive-soft text-destructive-soft-foreground border-destructive",
    info: "bg-info-soft text-info-soft-foreground border-info",
    neutral: "bg-muted text-muted-foreground border-border",
  }[color];
}

export function getStatusDotClasses(color: StatusColor) {
  return {
    success: "bg-success",
    warning: "bg-warning",
    danger: "bg-destructive",
    info: "bg-info",
    neutral: "bg-primary-4",
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

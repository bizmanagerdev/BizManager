import type { StatusColor } from "@/lib/ui/status-colors";

/**
 * THE single source of truth for status-pill styling. Every status badge/pill in
 * the app — the <Badge> status variants, <StatusBadge>, and all feature helpers —
 * derives its classes from here, so the look stays consistent and changes in one
 * place. Style = soft outline: light tinted bg + colored anchor text + colored
 * border. Warning uses navy text (orange text on a light bg is unreadable). The
 * actual colors come from the --*-soft / --* CSS tokens in globals.css.
 */
export const STATUS_PILL_CLASSES: Record<StatusColor, string> = {
  success: "border border-success bg-success-soft text-success-soft-foreground",
  warning: "border border-warning bg-warning-soft text-warning-soft-foreground",
  danger: "border border-destructive bg-destructive-soft text-destructive-soft-foreground",
  info: "border border-info bg-info-soft text-info-soft-foreground",
  neutral: "border border-border bg-muted/40 text-muted-foreground",
};

export function getStatusColorClasses(color: StatusColor) {
  return STATUS_PILL_CLASSES[color];
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

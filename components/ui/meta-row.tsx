import * as React from "react";

import { cn } from "@/lib/utils";

export interface MetaRowProps extends Omit<React.HTMLAttributes<HTMLElement>, "children"> {
  /** Values to join with a middle-dot separator; falsy entries are dropped. Use this OR children, not both. */
  items?: Array<React.ReactNode | false | null | undefined>;
  children?: React.ReactNode;
  /** Shown instead of rendering nothing when every item is falsy (e.g. "—"). */
  fallback?: React.ReactNode;
  /** "div" (default, a standalone row) or "span" for a wrapper that sits mid-sentence — pair with `inline-flex` in className. */
  as?: "div" | "span";
}

/**
 * Renders a list of short values (a date, a city, a phone number...) separated
 * by a middle dot, WITHOUT ever building that dot into a string. Each value is
 * its own flex child, so a wrap only ever happens between values — never mid-value
 * with a dangling "·" at the line end, which is what `.join(" · ")` produces at
 * large text sizes.
 */
export function MetaRow({ items, children, className, fallback, as: Tag = "div", ...props }: MetaRowProps) {
  const values = items
    ? items.filter((v) => v !== null && v !== undefined && v !== false && v !== "")
    : React.Children.toArray(children);

  if (values.length === 0) return fallback !== undefined ? <Tag className={className}>{fallback}</Tag> : null;

  return (
    <Tag
      className={cn(
        "flex flex-wrap items-center gap-x-1.5 gap-y-0.5",
        "[&>*+*]:before:content-['·'] [&>*+*]:before:mx-1.5 [&>*+*]:before:text-muted-foreground/50",
        className
      )}
      {...props}
    >
      {values.map((value, i) => (
        <span key={i}>{value}</span>
      ))}
    </Tag>
  );
}

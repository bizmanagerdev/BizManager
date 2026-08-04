"use client";

// The label-over-input pair every form in the app draws. It existed as eleven
// private copies that had drifted into three different looks; this is the one
// look, with the two legitimate sizes kept as a prop.

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Field({
  label,
  hint,
  required = false,
  size = "sm",
  htmlFor,
  className,
  children,
}: {
  label: ReactNode;
  /** Short "רשות" / "אם שונה מהטלפון" note appended to the label. */
  hint?: string;
  required?: boolean;
  /** "xs" is the denser, muted label used inside data-heavy tables and panels. */
  size?: "sm" | "xs";
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("space-y-1", className)}>
      <label
        htmlFor={htmlFor}
        className={cn(
          "font-medium",
          size === "xs" ? "text-xs text-muted-foreground" : "text-sm"
        )}
      >
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
        {hint ? <span className="font-normal text-muted-foreground"> · {hint}</span> : null}
      </label>
      {children}
    </div>
  );
}

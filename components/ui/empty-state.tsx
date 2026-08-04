"use client";

// "There's nothing here" — the dashed box that appears wherever a list, table
// or chart comes back empty. It existed as ~25 copies in four different
// paddings and three corner radii; this is the one.

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function EmptyState({
  children,
  icon,
  action,
  /** Tighter box, for empty states nested inside a card or a small panel. */
  dense = false,
  className,
}: {
  children: ReactNode;
  icon?: ReactNode;
  /** A button or link offering the obvious next step ("הוספת לקוח"). */
  action?: ReactNode;
  dense?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-dashed px-4 text-center text-sm text-muted-foreground",
        dense ? "py-4" : "py-10",
        className
      )}
    >
      {icon ? <div className="mb-2 flex justify-center">{icon}</div> : null}
      <div>{children}</div>
      {action ? <div className="mt-3 flex justify-center">{action}</div> : null}
    </div>
  );
}

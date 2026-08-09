"use client";

// Read-only "label ⟷ value" rows for review/summary steps, shared by the order
// and customer wizards so a summary reads the same wherever it appears.

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { EditButton } from "@/components/ui/icon-button";

/** Titled card holding a divided list of SummaryRows. */
export function SummarySection({
  icon,
  title,
  /** Jumps back to the step this section summarises. Renders a pencil beside
   *  the title — icon-only, so a row of sections stays scannable. */
  onEdit,
  editLabel,
  editDisabled = false,
  children,
  className,
}: {
  icon?: ReactNode;
  title: string;
  onEdit?: () => void;
  editLabel?: string;
  editDisabled?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center gap-2 text-sm font-medium">
        {icon ? <span className="text-muted-foreground">{icon}</span> : null}
        <span className="min-w-0 flex-1">{title}</span>
        {onEdit ? (
          <EditButton onClick={onEdit} disabled={editDisabled} label={editLabel ?? `עריכת ${title}`} />
        ) : null}
      </div>
      <div className="divide-y rounded-xl border">{children}</div>
    </div>
  );
}

/**
 * Inset by default, for rows sitting directly inside a SummarySection. Inside a
 * `Card` that already pads its content, pass `className="px-0 py-1.5"`.
 */
export function SummaryRow({
  label,
  value,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  className?: string;
}) {
  // A blank value reads as a broken row, so an empty string / null shows an
  // em-dash instead. Anything else (including 0) is printed as given.
  const shown = value === "" || value === null || value === undefined ? "—" : value;
  return (
    <div className={cn("flex items-start justify-between gap-4 px-3 py-2.5 text-sm", className)}>
      <span className="text-muted-foreground">{label}</span>
      <span className="text-end font-medium text-foreground">{shown}</span>
    </div>
  );
}

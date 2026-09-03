"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDownIcon } from "@/components/ui/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusBadge } from "@/components/ui/status-badge";
import { getProjectStatusLabel } from "@/lib/ui/status-colors";
import { toHebrewError } from "@/lib/error-messages";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { scheduleDeferredAction } from "@/lib/undo-engine";

// The project's status — as the סטטוס הפרויקט card's headline ("text" variant,
// the project detail page) or as the status badge itself ("badge" variant, the
// projects list) — and the control that changes it. Posts to the status-only
// endpoint; the detail page refreshes the route afterward (`onChanged` unset),
// the list instead patches its own row locally via `onChanged` since a full
// router.refresh() there would fight the list's own infinite-scroll state.

const STATUS_OPTIONS = ["quote", "planned", "active", "on_hold", "completed", "cancelled"];

export function ProjectStatusPicker({
  projectId,
  status,
  canEdit,
  variant = "text",
  badgeClassName,
  onChanged,
}: {
  projectId: string;
  status: string;
  canEdit: boolean;
  variant?: "text" | "badge";
  /** "badge" variant only — passed through to the underlying StatusBadge. */
  badgeClassName?: string;
  /** Called after a successful save instead of the default router.refresh(). */
  onChanged?: (nextStatus: string) => void;
}) {
  const router = useRouter();
  const [value, setValue] = useState(status);

  const label = value ? getProjectStatusLabel(value) : "—";

  if (!canEdit) {
    return variant === "badge" ? (
      <StatusBadge value={value} type="project" className={badgeClassName} />
    ) : (
      <span className="text-lg font-bold leading-snug">{label}</span>
    );
  }

  function select(next: string) {
    if (next === value) return;
    const previous = value;
    scheduleDeferredAction({
      key: `project-status:${projectId}`,
      message: "הסטטוס עודכן",
      onApplyOptimistic: () => setValue(next),
      onRevert: () => setValue(previous),
      onCommit: async () => {
        // RLS on `projects` already scopes this write (admin/office only — no
        // worker UPDATE policy exists), same as the old route's RLS-bound client.
        // `status` is a Postgres enum (project_status_enum), so an invalid value
        // is rejected by the database itself, not just the STATUS_OPTIONS list.
        const { error } = await createSupabaseBrowserClient()
          .from("projects")
          .update({ status: next })
          .eq("id", projectId);
        if (error) return { ok: false, error: toHebrewError(error.message, "") };
        if (onChanged) onChanged(next);
        else router.refresh();
        return { ok: true };
      },
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={
          variant === "badge"
            ? "inline-flex items-center gap-1 rounded-full transition-opacity hover:opacity-80 disabled:opacity-60"
            : "flex items-center gap-1 text-lg font-bold leading-snug hover:text-secondary disabled:opacity-60"
        }
        aria-label="שינוי סטטוס הפרויקט"
        title="שינוי סטטוס הפרויקט"
      >
        {variant === "badge" ? (
          <StatusBadge value={value} type="project" className={badgeClassName} />
        ) : (
          <>
            {label}
            <ChevronDownIcon className="h-4 w-4 text-muted-foreground" />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {STATUS_OPTIONS.map((option) => (
          <DropdownMenuItem key={option} onClick={() => select(option)}>
            {getProjectStatusLabel(option)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

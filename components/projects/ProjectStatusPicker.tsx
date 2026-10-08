"use client";

import { useState, useTransition } from "react";
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
import { PROJECT_STATUSES } from "@/lib/projects/project-input";
import { deviceProjectSaves } from "@/lib/projects/device-project-saves";

// The project's status — as the סטטוס הפרויקט card's headline ("text" variant,
// the project detail page) or as the status badge itself ("badge" variant, the
// projects list) — and the control that changes it. Saved on the phone first
// where `devicePage` can be drawn from the device copy (it shows there at once,
// with no signal too, and goes up through /api/projects/update-status);
// otherwise written to the server: the detail page refreshes the route
// afterward (`onChanged` unset), the list instead patches its own row locally
// via `onChanged` since a full router.refresh() there would fight the list's
// own infinite-scroll state.

export function ProjectStatusPicker({
  projectId,
  status,
  canEdit,
  variant = "text",
  badgeClassName,
  onChanged,
  devicePage,
}: {
  projectId: string;
  status: string;
  canEdit: boolean;
  variant?: "text" | "badge";
  /** "badge" variant only — passed through to the underlying StatusBadge. */
  badgeClassName?: string;
  /** Called after a successful save instead of the default router.refresh(). */
  onChanged?: (nextStatus: string) => void;
  /** The page it's on, when that page can be drawn from the device copy: the save is made there first. */
  devicePage?: "projects" | "projectPage";
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
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
        // On the phone first (lib/projects/device-project-saves.ts): a page
        // drawn from it shows it by itself, no refresh.
        const device = devicePage ? deviceProjectSaves(devicePage) : null;
        if (device && (await device.change(projectId, { kind: "status", status: next }))) {
          onChanged?.(next);
          return { ok: true };
        }
        // RLS on `projects` already scopes this write (admin/office only — no
        // worker UPDATE policy exists), same as the old route's RLS-bound client.
        // `status` is a Postgres enum (project_status_enum), so an invalid value
        // is rejected by the database itself, not just the PROJECT_STATUSES list.
        const { error } = await createSupabaseBrowserClient()
          .from("projects")
          .update({ status: next })
          .eq("id", projectId);
        if (error) return { ok: false, error: toHebrewError(error.message, "") };
        if (onChanged) onChanged(next);
        else startTransition(() => { router.refresh(); });
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
        {PROJECT_STATUSES.map((option) => (
          <DropdownMenuItem key={option} onClick={() => select(option)}>
            {getProjectStatusLabel(option)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

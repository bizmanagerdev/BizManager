"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDownIcon, SpinnerIcon } from "@/components/ui/icons";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getProjectStatusLabel } from "@/lib/ui/status-colors";
import { toHebrewError } from "@/lib/error-messages";

// The project's status as the סטטוס הפרויקט card's headline — and the control
// that changes it. Posts to the status-only endpoint, then refreshes so every
// other place the status appears (badges, filters, alerts) follows.

const STATUS_OPTIONS = ["quote", "planned", "active", "on_hold", "completed", "cancelled"];

export function ProjectStatusPicker({
  projectId,
  status,
  canEdit,
}: {
  projectId: string;
  status: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [, startTransition] = useTransition();
  const [value, setValue] = useState(status);

  const label = value ? getProjectStatusLabel(value) : "—";

  if (!canEdit) {
    return <span className="text-lg font-bold leading-snug">{label}</span>;
  }

  async function select(next: string) {
    if (next === value || saving) return;
    const previous = value;
    setValue(next);
    setSaving(true);
    try {
      const res = await fetch("/api/projects/update-status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ project_id: projectId, status: next }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setValue(previous);
        toast.error("שגיאה בעדכון סטטוס", { description: toHebrewError(json?.error, "") });
        return;
      }
      toast.success("הסטטוס עודכן");
      startTransition(() => router.refresh());
    } catch (err: unknown) {
      setValue(previous);
      toast.error("שגיאה בעדכון סטטוס", { description: toHebrewError(err, "") });
    } finally {
      setSaving(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={saving}
        className="flex items-center gap-1 text-lg font-bold leading-snug hover:text-secondary disabled:opacity-60"
        aria-label="שינוי סטטוס הפרויקט"
        title="שינוי סטטוס הפרויקט"
      >
        {label}
        {saving ? (
          <SpinnerIcon className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <ChevronDownIcon className="h-4 w-4 text-muted-foreground" />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {STATUS_OPTIONS.map((option) => (
          <DropdownMenuItem key={option} onClick={() => void select(option)}>
            {getProjectStatusLabel(option)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

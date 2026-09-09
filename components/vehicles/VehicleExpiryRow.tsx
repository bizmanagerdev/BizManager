// One "bar" for a car's טסט / ביטוח / רישוי — label + a kind-specific icon
// anchored at one end, the due date + status pill at the other, each row its
// own soft rounded pill (not one bordered box with thin dividers). Shared by
// the /vehicles list card and the car detail header so the two never drift.

"use client";

import { useState } from "react";
import Link from "next/link";
import { AddIcon, ApprovedDocumentIcon, EditIcon, IdCardIcon, ShieldIcon, TaskIcon, type IconComponent } from "@/components/ui/icons";
import { Badge } from "@/components/ui/badge";
import { SwipeActions } from "@/components/ui/swipe-actions";
import { expiryStatus, type VehicleSourceTask } from "@/lib/vehicles";

export type VehicleExpiryKind = "test" | "insurance" | "license";

const KIND_ICONS: Record<VehicleExpiryKind, IconComponent> = {
  test: ApprovedDocumentIcon,
  insurance: ShieldIcon,
  license: IdCardIcon,
};

/** "2027-02-16" (or a full ISO timestamp) → "16.02.2027", the Hebrew day-first convention. */
function formatExpiryDate(value: string): string {
  const [y, m, d] = value.slice(0, 10).split("-");
  if (!y || !m || !d) return value;
  return `${d}.${m}.${y}`;
}

export function VehicleExpiryRow({
  kind,
  label,
  date,
  onEdit,
  sourceTask,
}: {
  kind: VehicleExpiryKind;
  label: string;
  date: string | null;
  /** Swipe-to-edit (phone only) — opens the vehicle's edit form. Omit to keep the row read-only. */
  onEdit?: () => void;
  /** The task that led to this date, if one was picked in the quick-edit dialog — links "valid until X" back to "why". Only ever set on the detail page (fetchVehicle resolves it; the fleet list doesn't). */
  sourceTask?: VehicleSourceTask;
}) {
  const status = expiryStatus(date);
  const Icon = KIND_ICONS[kind];
  const [swiped, setSwiped] = useState(false);

  // No date at all is a real gap (unlike an ordinary field a user may not
  // need), so it must read as incomplete rather than as settled data —
  // dashed border, muted fill — and be directly tappable to fill in, not
  // hidden behind the swipe gesture the valid rows use below.
  if (!date) {
    return (
      <button
        type="button"
        onClick={onEdit}
        disabled={!onEdit}
        className="flex w-full items-center justify-between gap-3 rounded-xl border border-dashed border-border/70 bg-muted/30 px-3 py-2.5 text-start text-muted-foreground disabled:cursor-default"
      >
        <span className="flex items-center gap-2 text-sm font-medium">
          <span>{label}</span>
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground/50" />
        </span>
        {onEdit ? (
          <span className="flex items-center gap-1 text-sm font-medium text-secondary">
            <AddIcon className="h-3.5 w-3.5" />
            הגדרה
          </span>
        ) : (
          <span className="text-sm">לא הוגדר</span>
        )}
      </button>
    );
  }

  const content = (
    <div className="rounded-xl bg-muted/40 px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <span>{label}</span>
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{formatExpiryDate(date)}</span>
          {status ? <Badge variant={status.tone}>{status.label}</Badge> : null}
        </div>
      </div>
      {/* The causal link the task-done checkmark and this date otherwise have
          no visible connection to — "why is this valid until 16.02.2027?
          because this task got done." Stopping propagation keeps a tap here
          from also triggering the row's swipe-to-edit on phone. */}
      {sourceTask ? (
        <div className="mt-1 flex justify-end">
          <Link
            href={`/tasks/${sourceTask.id}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex min-w-0 items-center gap-1 text-xs text-secondary hover:underline"
          >
            <TaskIcon className="h-3 w-3 shrink-0" />
            <span>מהמשימה: {sourceTask.subject || "משימה"}</span>
          </Link>
        </div>
      ) : null}
    </div>
  );

  if (!onEdit) return content;

  return (
    <>
      <div className="lg:hidden">
        <SwipeActions
          className="rounded-xl"
          open={swiped}
          onOpenChange={setSwiped}
          actions={[
            {
              key: "edit",
              label: "עריכה",
              icon: <EditIcon className="h-4 w-4" />,
              onSelect: onEdit,
              className: "bg-secondary text-secondary-foreground",
            },
          ]}
        >
          {content}
        </SwipeActions>
      </div>
      <div className="hidden lg:block">{content}</div>
    </>
  );
}

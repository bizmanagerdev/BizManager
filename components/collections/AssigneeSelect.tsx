"use client";

import { useAssignableUsers } from "@/hooks/useAssignableUsers";

// Assignee (אחראי) picker for reminders. Empty value means "default to me" on
// create (the API falls back to the creator) — pass includeMeDefault to label
// the empty option accordingly. For edit, pass emptyLabel (e.g. "ללא אחראי") so
// there's always a usable option, and currentLabel so the existing assignee is
// shown even if the fetched list hasn't loaded / doesn't include them.
export function AssigneeSelect({
  value,
  onChange,
  includeMeDefault = false,
  emptyLabel,
  currentLabel,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  includeMeDefault?: boolean;
  emptyLabel?: string;
  currentLabel?: string;
  className?: string;
}) {
  const { users } = useAssignableUsers();
  const resolvedEmptyLabel = includeMeDefault ? "אני (ברירת מחדל)" : emptyLabel;
  const currentInList = !value || users.some((u) => u.id === value);
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={className ?? "h-10 w-full rounded-md border border-input bg-background px-3 text-sm"}
    >
      {resolvedEmptyLabel != null ? <option value="">{resolvedEmptyLabel}</option> : null}
      {value && !currentInList ? <option value={value}>{currentLabel ?? "אחראי נוכחי"}</option> : null}
      {users.map((u) => (
        <option key={u.id} value={u.id}>
          {u.label}
        </option>
      ))}
    </select>
  );
}

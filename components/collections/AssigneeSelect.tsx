"use client";

import { useAssignableUsers } from "@/hooks/useAssignableUsers";

// Assignee (אחראי) picker for reminders. Empty value means "default to me" on
// create (the API falls back to the creator) — pass includeMeDefault to label
// the empty option accordingly; for edit, omit it so a real user is chosen.
export function AssigneeSelect({
  value,
  onChange,
  includeMeDefault = false,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  includeMeDefault?: boolean;
  className?: string;
}) {
  const { users } = useAssignableUsers();
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={className ?? "h-10 w-full rounded-md border border-input bg-background px-3 text-sm"}
    >
      {includeMeDefault ? <option value="">אני (ברירת מחדל)</option> : null}
      {users.map((u) => (
        <option key={u.id} value={u.id}>
          {u.label}
        </option>
      ))}
    </select>
  );
}

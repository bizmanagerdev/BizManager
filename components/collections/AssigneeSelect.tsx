"use client";

import { useAssignableUsers } from "@/hooks/useAssignableUsers";
import { NativeSelect } from "@/components/ui/native-select";

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
    <NativeSelect
      value={value}
      onChange={(e) => onChange(e.target.value)} className={className}
    >
      {resolvedEmptyLabel != null ? <option value="">{resolvedEmptyLabel}</option> : null}
      {value && !currentInList ? <option value={value}>{currentLabel ?? "אחראי נוכחי"}</option> : null}
      {users.map((u) => (
        <option key={u.id} value={u.id}>
          {u.label}
        </option>
      ))}
    </NativeSelect>
  );
}

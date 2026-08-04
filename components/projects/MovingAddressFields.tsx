"use client";

import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

/** Elevator state as the forms hold it: "" = unspecified, "yes"/"no" = known. */
export type Elevator = "" | "yes" | "no";

/** One move endpoint (pickup or drop-off) as the create/edit forms hold it. */
export type MovingEndpointValue = {
  address: string;
  floor: string;
  hasElevator: Elevator;
};

export const EMPTY_MOVING_ENDPOINT: MovingEndpointValue = { address: "", floor: "", hasElevator: "" };

/** Map the form's tri-state select to the boolean|null the DB column stores. */
export function elevatorToBool(value: Elevator): boolean | null {
  if (value === "yes") return true;
  if (value === "no") return false;
  return null;
}

/** Map a stored boolean|null back to the form's tri-state select value. */
export function boolToElevator(value: boolean | null | undefined): Elevator {
  if (value === true) return "yes";
  if (value === false) return "no";
  return "";
}

/** Address + floor + elevator inputs for a single move endpoint. Rendered twice
 *  (מוצא / יעד) by both the create wizard and the details edit dialog. */
export function MovingEndpointFields({
  title,
  value,
  onChange,
  disabled,
}: {
  title: string;
  value: MovingEndpointValue;
  onChange: (next: MovingEndpointValue) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2 rounded-xl border border-border/70 bg-background/60 p-3">
      <div className="text-sm font-medium">{title}</div>
      <label className="block space-y-1">
        <span className="text-xs text-muted-foreground">כתובת</span>
        <Input
          value={value.address}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, address: e.target.value })}
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground">קומה</span>
          <Input
            value={value.floor}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, floor: e.target.value })}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground">מעלית</span>
          <NativeSelect 
            value={value.hasElevator}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, hasElevator: e.target.value as Elevator })}
          >
            <option value="">לא צוין</option>
            <option value="yes">יש מעלית</option>
            <option value="no">אין מעלית</option>
          </NativeSelect>
        </label>
      </div>
    </div>
  );
}

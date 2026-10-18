"use client";

import { useId } from "react";
import { addressLine, type StructuredAddress } from "@/lib/address/structured";
import { AddressPicker } from "@/components/ui/address-picker";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

/** Elevator state as the forms hold it: "" = unspecified, "yes"/"no" = known. */
export type Elevator = "" | "yes" | "no";

/** One move endpoint (pickup or drop-off) as the create/edit forms hold it. */
export type MovingEndpointValue = {
  /** Its line: the picked address's, or as saved before the picker. */
  address: string;
  /** Picked from Google (components/ui/address-picker.tsx). */
  addr?: StructuredAddress | null;
  floor: string;
  hasElevator: Elevator;
};

export const EMPTY_MOVING_ENDPOINT: MovingEndpointValue = { address: "", addr: null, floor: "", hasElevator: "" };

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
  const id = useId();
  // The shared Field in its small panel size (owner, 2026-10-11: every form
  // the same label-over-input), each label still tied to its input.
  return (
    <div className="space-y-2 rounded-xl border border-border/70 bg-background/60 p-3">
      <div className="text-sm font-medium">{title}</div>
      {/* Picked from Google's list like every address (owner, 2026-10-16).
          The floor and the lift stay their own fields, so no unit box here. */}
      <Field label="כתובת" size="xs" htmlFor={`${id}-address`}>
        <AddressPicker
          id={`${id}-address`}
          ariaLabel={`כתובת ${title}`}
          value={value.addr ?? null}
          allowUnit={false}
          disabled={disabled}
          onChange={(next) => onChange({ ...value, addr: next, address: next ? addressLine(next) : "" })}
          legacyText={value.addr ? null : value.address}
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="קומה" size="xs" htmlFor={`${id}-floor`}>
          <Input
            id={`${id}-floor`}
            value={value.floor}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, floor: e.target.value })}
          />
        </Field>
        <Field label="מעלית" size="xs" htmlFor={`${id}-elevator`}>
          <NativeSelect
            id={`${id}-elevator`}
            value={value.hasElevator}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, hasElevator: e.target.value as Elevator })}
          >
            <option value="">לא צוין</option>
            <option value="yes">יש מעלית</option>
            <option value="no">אין מעלית</option>
          </NativeSelect>
        </Field>
      </div>
    </div>
  );
}

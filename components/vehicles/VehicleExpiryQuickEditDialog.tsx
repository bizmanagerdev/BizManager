"use client";

// Swiping a single טסט / ביטוח / רישוי row opens THIS — just that one date —
// instead of the full vehicle edit form. It still submits a complete
// VehicleInput under the hood (updateVehicle overwrites every field), so the
// other fields are carried over unchanged from the vehicle's current values.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormDialog } from "@/components/ui/form-dialog";
import { DateInput } from "@/components/ui/date-input";
import { updateVehicle } from "@/app/(app)/vehicles/actions";
import { buildVehiclePatch, vehicleToForm, type Vehicle, type VehicleInput } from "@/lib/vehicles";
import { scheduleDeferredEdit } from "@/lib/undo-engine";
import type { VehicleExpiryKind } from "./VehicleExpiryRow";

const FIELD_BY_KIND: Record<VehicleExpiryKind, keyof VehicleInput> = {
  test: "test_due_date",
  insurance: "insurance_due_date",
  license: "license_due_date",
};

const TITLE_BY_KIND: Record<VehicleExpiryKind, string> = {
  test: "עדכון תאריך טסט",
  insurance: "עדכון תאריך ביטוח",
  license: "עדכון תאריך רישוי",
};

export function VehicleExpiryQuickEditDialog({
  vehicle,
  kind,
  open,
  onOpenChange,
}: {
  /** null while closed — lets the caller keep one instance mounted (like ConfirmDialog) instead of remounting per row. */
  vehicle: Vehicle | null;
  kind: VehicleExpiryKind | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [date, setDate] = useState("");
  // Which vehicle+kind `date` currently reflects — re-read from `vehicle` the
  // moment a *different* one opens, and forget it again on close so a
  // reopened-but-unsaved edit never reappears as if it had been kept.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const targetKey = vehicle && kind ? `${vehicle.tagId}:${kind}` : null;
  if (open && vehicle && kind && targetKey !== loadedFor) {
    setLoadedFor(targetKey);
    setDate(vehicleToForm(vehicle)[FIELD_BY_KIND[kind]]);
  } else if (!open && loadedFor !== null) {
    setLoadedFor(null);
  }

  function submit() {
    if (!kind || !vehicle) return;
    const form: VehicleInput = { ...vehicleToForm(vehicle), [FIELD_BY_KIND[kind]]: date };
    onOpenChange(false);
    scheduleDeferredEdit({
      scope: "vehicle",
      id: vehicle.tagId,
      message: "התאריך עודכן.",
      patch: buildVehiclePatch(form),
      onCommit: async () => {
        const result = await updateVehicle(vehicle.tagId, form);
        if (result.ok) {
          router.refresh();
          return { ok: true };
        }
        return { ok: false, error: result.error };
      },
    });
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={kind ? TITLE_BY_KIND[kind] : ""}
      size="formSm"
      onSubmit={submit}
      submitLabel="שמירה"
    >
      <div className="space-y-1">
        <label className="text-sm font-medium">תאריך</label>
        <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
    </FormDialog>
  );
}

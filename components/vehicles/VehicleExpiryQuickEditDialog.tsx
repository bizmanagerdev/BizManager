"use client";

// Swiping a single טסט / ביטוח / רישוי row opens THIS — just that one date —
// instead of the full vehicle edit form. It still submits a complete
// VehicleInput under the hood (updateVehicle overwrites every field), so the
// other fields are carried over unchanged from the vehicle's current values.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormDialog } from "@/components/ui/form-dialog";
import { DateInput } from "@/components/ui/date-input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { updateVehicle } from "@/app/(app)/vehicles/actions";
import { buildVehiclePatch, vehicleToForm, taskStatusLabel, type Vehicle, type VehicleInput, type VehicleTask } from "@/lib/vehicles";
import { scheduleDeferredEdit } from "@/lib/undo-engine";
import type { VehicleExpiryKind } from "./VehicleExpiryRow";

const FIELD_BY_KIND: Record<VehicleExpiryKind, keyof VehicleInput> = {
  test: "test_due_date",
  insurance: "insurance_due_date",
  license: "license_due_date",
};

const SOURCE_TASK_FIELD_BY_KIND: Record<VehicleExpiryKind, keyof VehicleInput> = {
  test: "test_source_task_id",
  insurance: "insurance_source_task_id",
  license: "license_source_task_id",
};

const TITLE_BY_KIND: Record<VehicleExpiryKind, string> = {
  test: "עדכון תאריך טסט",
  insurance: "עדכון תאריך ביטוח",
  license: "עדכון תאריך רישוי",
};

export function VehicleExpiryQuickEditDialog({
  vehicle,
  kind,
  tasks = [],
  open,
  onOpenChange,
}: {
  /** null while closed — lets the caller keep one instance mounted (like ConfirmDialog) instead of remounting per row. */
  vehicle: Vehicle | null;
  kind: VehicleExpiryKind | null;
  /**
   * The vehicle's own tagged tasks, to pick "which task led to this" from —
   * same list VehicleActivityClient's Tasks card shows. Omitted from the
   * /vehicles LIST page's quick-edit (only the detail page loads a vehicle's
   * tasks) — the picker just doesn't render there, same as having none yet.
   */
  tasks?: VehicleTask[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [date, setDate] = useState("");
  const [sourceTaskId, setSourceTaskId] = useState("");
  // Which vehicle+kind `date`/`sourceTaskId` currently reflect — re-read from
  // `vehicle` the moment a *different* one opens, and forget it again on close
  // so a reopened-but-unsaved edit never reappears as if it had been kept.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const targetKey = vehicle && kind ? `${vehicle.tagId}:${kind}` : null;
  if (open && vehicle && kind && targetKey !== loadedFor) {
    setLoadedFor(targetKey);
    const form = vehicleToForm(vehicle);
    setDate(form[FIELD_BY_KIND[kind]]);
    setSourceTaskId(form[SOURCE_TASK_FIELD_BY_KIND[kind]]);
  } else if (!open && loadedFor !== null) {
    setLoadedFor(null);
  }

  function submit() {
    if (!kind || !vehicle) return;
    const form: VehicleInput = {
      ...vehicleToForm(vehicle),
      [FIELD_BY_KIND[kind]]: date,
      [SOURCE_TASK_FIELD_BY_KIND[kind]]: sourceTaskId,
    };
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
      <div className="space-y-4">
        <div className="space-y-1">
          <label className="text-sm font-medium">תאריך</label>
          <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        {/* Nothing to link to on the LIST page's quick-edit (tasks omitted there)
            or for a car with no tasks yet — skip the section instead of showing
            an empty, non-functional picker. */}
        {tasks.length > 0 ? (
          <div className="space-y-1">
            <label className="text-sm font-medium">המשימה שהובילה לעדכון (לא חובה)</label>
            <SearchableSelect
              value={sourceTaskId}
              onChange={setSourceTaskId}
              emptyOptionLabel="ללא קישור"
              placeholder="בחירת משימה..."
              ariaLabel="המשימה שהובילה לעדכון"
              options={tasks.map((t) => ({
                value: t.id,
                label: t.subject || "משימה",
                hint: taskStatusLabel(t.status),
              }))}
            />
          </div>
        ) : null}
      </div>
    </FormDialog>
  );
}

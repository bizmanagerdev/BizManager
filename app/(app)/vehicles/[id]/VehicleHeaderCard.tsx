"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FormDialog } from "@/components/ui/form-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { EditButton } from "@/components/ui/icon-button";
import { DeleteIcon, EditIcon, MoreIcon, NotificationIcon } from "@/components/ui/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HeaderActionsMenu } from "@/components/layout/HeaderActionsMenu";
import { useSetHeaderAction } from "@/components/layout/page-title-context";
import AddReminderButton from "@/components/reminders/AddReminderButton";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import {
  EMPTY_VEHICLE_FORM,
  vehicleToForm,
  buildVehiclePatch,
  formatMileage,
  type Vehicle,
  type VehicleInput,
  type VehicleTask,
} from "@/lib/vehicles";
import VehicleFormFields from "@/components/vehicles/VehicleFormFields";
import VehiclePhotoAvatar from "@/components/vehicles/VehiclePhotoAvatar";
import { VehicleExpiryRow, type VehicleExpiryKind } from "@/components/vehicles/VehicleExpiryRow";
import { VehicleExpiryQuickEditDialog } from "@/components/vehicles/VehicleExpiryQuickEditDialog";
import { deleteVehicle, updateVehicle } from "../actions";
import { useUndoOverlay } from "@/hooks/useUndoOverlay";
import { scheduleDeferredDelete, scheduleDeferredEdit } from "@/lib/undo-engine";

/** The vehicle detail page's own header — lets you edit the car right here, not only from the /vehicles list. */
export default function VehicleHeaderCard({ vehicle, tasks }: { vehicle: Vehicle; tasks: VehicleTask[] }) {
  const router = useRouter();
  const [display] = useUndoOverlay([vehicle], (v) => v.tagId, "vehicle");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<VehicleInput>(EMPTY_VEHICLE_FORM);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [quickEditKind, setQuickEditKind] = useState<VehicleExpiryKind | null>(null);

  function set<K extends keyof VehicleInput>(key: K, value: VehicleInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function openEdit() {
    setForm(vehicleToForm(display));
    setOpen(true);
  }

  function submit() {
    if (!form.name.trim() && !form.make_model.trim() && !form.license_plate.trim()) {
      toast.error("יש להזין לפחות שם, דגם או מספר רישוי.");
      return;
    }
    setOpen(false);
    scheduleDeferredEdit({
      scope: "vehicle",
      id: vehicle.tagId,
      message: "הרכב עודכן.",
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

  function confirmDelete() {
    setDeleteOpen(false);
    emitNavigationStart();
    router.push("/vehicles");
    scheduleDeferredDelete({
      scope: "vehicle",
      id: vehicle.tagId,
      message: "הרכב נמחק.",
      onCommit: async () => {
        const result = await deleteVehicle(vehicle.tagId);
        if (result.ok) return { ok: true };
        return { ok: false, error: result.error };
      },
    });
  }

  // Phone: same actions, but as the top bar's ⋮ — this card has no room for a
  // button row above the fold there. Desktop keeps the inline row below.
  const headerMenu = useMemo(
    () => (
      <HeaderActionsMenu>
        <DropdownMenuItem className="gap-2" onSelect={() => setReminderOpen(true)}>
          <NotificationIcon className="h-4 w-4 text-warning" />
          <span>תזכורת</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          className="gap-2"
          onSelect={() => {
            setForm(vehicleToForm(display));
            setOpen(true);
          }}
        >
          <EditIcon className="h-4 w-4" />
          <span>עריכה</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          className="gap-2 text-destructive focus:text-destructive"
          onSelect={() => setDeleteOpen(true)}
        >
          <DeleteIcon className="h-4 w-4" />
          <span>מחיקת רכב</span>
        </DropdownMenuItem>
      </HeaderActionsMenu>
    ),
    [display]
  );
  useSetHeaderAction(headerMenu);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <VehiclePhotoAvatar tagId={vehicle.tagId} name={display.name} photoUrl={display.photoUrl} size="lg" editable />
          <div className="min-w-0 break-words">
            <h1 className="text-2xl font-semibold">{display.name}</h1>
            <p className="text-sm text-muted-foreground">
              {[display.makeModel, display.licensePlate, display.year, formatMileage(display.mileage)]
                .filter(Boolean)
                .join(" · ") || "—"}
            </p>
          </div>
        </div>
        <div className="hidden shrink-0 items-center gap-1 lg:flex">
          <AddReminderButton
            entityType="vehicle"
            entityId={vehicle.tagId}
            label={display.name}
            className="h-9 w-9 p-0"
            iconOnly
            open={reminderOpen}
            onOpenChange={setReminderOpen}
          />
          <EditButton onClick={openEdit} label="עריכת רכב" />
          {/* Delete is a rare, destructive action — same "demote it into a ⋯"
              rule as every list row in this app (RowActionsMenu below), not a
              third same-weight button beside reminder/edit. A solid red-outline
              icon sitting first in the group (visually leftmost, RTL) was the
              loudest thing on the page. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 text-muted-foreground hover:text-foreground"
                title="פעולות נוספות"
                aria-label="פעולות נוספות"
              >
                <MoreIcon className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem
                className="gap-2 text-destructive focus:text-destructive"
                onSelect={() => setDeleteOpen(true)}
              >
                <DeleteIcon className="h-4 w-4" />
                <span>מחיקת רכב</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <VehicleExpiryRow
          kind="test"
          label="טסט"
          date={display.testDueDate}
          onEdit={() => setQuickEditKind("test")}
          sourceTask={display.testSourceTask}
        />
        <VehicleExpiryRow
          kind="insurance"
          label="ביטוח"
          date={display.insuranceDueDate}
          onEdit={() => setQuickEditKind("insurance")}
          sourceTask={display.insuranceSourceTask}
        />
        <VehicleExpiryRow
          kind="license"
          label="רישוי"
          date={display.licenseDueDate}
          onEdit={() => setQuickEditKind("license")}
          sourceTask={display.licenseSourceTask}
        />
      </div>

      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="עריכת רכב"
        description="פרטי הרכב משמשים לתיוג הוצאות, משימות ומסמכים."
        size="form2xl"
        onSubmit={submit}
        submitLabel="שמירה"
      >
        <VehicleFormFields form={form} set={set} />
      </FormDialog>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="מחיקת רכב"
        description="הרכב יימחק והתיוג שלו יוסר מההוצאות, ההכנסות, המשימות והמסמכים — אך הם עצמם לא יימחקו."
        confirmLabel="מחיקה"
        destructive
        onConfirm={confirmDelete}
      />

      <VehicleExpiryQuickEditDialog
        vehicle={display}
        kind={quickEditKind}
        tasks={tasks}
        open={quickEditKind !== null}
        onOpenChange={(open) => !open && setQuickEditKind(null)}
      />
    </div>
  );
}

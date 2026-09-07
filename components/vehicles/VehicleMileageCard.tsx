"use client";

// "Mileage isn't a field — it's a reading with a date attached" (user,
// 2026-09-07). Lives directly under the identity block, NOT beside טסט/
// ביטוח/רישוי: that band is compliance (three dates that expire), mileage
// doesn't expire — it's a property of the car, read at a moment in time.
//
// This is the "log + display" slice: the big number, honest recency (and
// staleness once it's old), and the one capture point that lives on the
// record itself — "a one-tap update... keypad opening on a numeric field
// pre-filled with the last value." Feeding the same log from garage expenses
// or test-task completion, the monthly-average/service-progress meter, the
// lease-cap meter, and the low-usage flag are explicitly deferred.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AddIcon, GaugeIcon } from "@/components/ui/icons";
import { FormDialog } from "@/components/ui/form-dialog";
import { Input } from "@/components/ui/input";
import { addVehicleMileageReading } from "@/app/(app)/vehicles/actions";
import { formatMileage, type Vehicle } from "@/lib/vehicles";
import { scheduleDeferredEdit } from "@/lib/undo-engine";
import { cn } from "@/lib/utils";

/** "Local calendar date" from a client Date — NOT toISOString(), which converts to UTC and can land on the wrong day near midnight Israel time. Purely for the optimistic patch; the real date is computed server-side (todayInIsrael() in actions.ts) and lands on refresh. */
function localDateString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "לפני 5 ימים" while recent; past 60 days it reads as stale, same as an unset expiry row. */
function recencyLabel(dateStr: string): { label: string; stale: boolean } {
  const then = new Date(`${dateStr}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - then.getTime()) / 86_400_000);
  if (days <= 0) return { label: "עודכן היום", stale: false };
  if (days === 1) return { label: "עודכן אתמול", stale: false };
  if (days <= 60) return { label: `עודכן לפני ${days} ימים`, stale: false };
  const months = Math.max(1, Math.round(days / 30));
  return { label: `לא עודכן ${months} חודשים`, stale: true };
}

export default function VehicleMileageCard({ vehicle }: { vehicle: Vehicle }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");

  function openDialog() {
    setValue(vehicle.mileage != null ? String(vehicle.mileage) : "");
    setOpen(true);
  }

  const reading = Number(value);
  const validReading = value.trim() !== "" && Number.isInteger(reading) && reading >= 0;
  const belowCurrent = validReading && vehicle.mileage != null && reading < vehicle.mileage;

  function submit() {
    if (!validReading) return;
    setOpen(false);
    scheduleDeferredEdit({
      scope: "vehicle",
      id: vehicle.tagId,
      message: "הקילומטרים עודכנו.",
      patch: { mileage: reading, mileageUpdatedAt: localDateString(new Date()) },
      onCommit: async () => {
        const result = await addVehicleMileageReading(vehicle.tagId, reading);
        if (result.ok) {
          router.refresh();
          return { ok: true };
        }
        return { ok: false, error: result.error };
      },
    });
  }

  const recency = vehicle.mileageUpdatedAt ? recencyLabel(vehicle.mileageUpdatedAt) : null;

  return (
    <>
      {vehicle.mileage == null ? (
        // Same "incomplete, not just empty" treatment as an unset expiry row —
        // dashed border, muted fill, directly tappable.
        <button
          type="button"
          onClick={openDialog}
          className="flex w-full items-center justify-between gap-3 rounded-xl border border-dashed border-border/70 bg-muted/30 px-3 py-2.5 text-start text-muted-foreground"
        >
          <span className="flex items-center gap-2 text-sm font-medium">
            <span>קילומטרים</span>
            <GaugeIcon className="h-4 w-4 shrink-0 text-muted-foreground/50" />
          </span>
          {/* Same word (and "+" glyph) the sibling טסט/ביטוח/רישוי rows use in
              this identical dashed/unset state (VehicleExpiryRow) —
              "הוספת קריאה" was this row inventing its own wording instead of
              matching them. */}
          <span className="flex items-center gap-1 text-sm font-medium text-secondary">
            <AddIcon className="h-3.5 w-3.5" />
            הגדרה
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={openDialog}
          className="flex w-full items-center justify-between gap-3 rounded-xl bg-muted/40 px-3 py-2.5 text-start"
        >
          <div className="flex items-center gap-2">
            <GaugeIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div>
              <div className="text-xl font-semibold tabular-nums">{formatMileage(vehicle.mileage)}</div>
              {recency ? (
                <div className={cn("text-xs", recency.stale ? "text-muted-foreground/60" : "text-muted-foreground")}>
                  {recency.label}
                </div>
              ) : null}
            </div>
          </div>
          <span className="text-sm font-medium text-secondary">עדכון</span>
        </button>
      )}

      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="עדכון קילומטרים"
        size="formSm"
        onSubmit={submit}
        submitLabel="שמירה"
      >
        <div className="space-y-1">
          <label className="text-sm font-medium">קילומטרים נוכחיים</label>
          {/* autoFocus is deliberate — this dialog exists so opening it and
              typing the new number IS the whole interaction. */}
          <Input inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
          {belowCurrent ? (
            <p className="text-xs text-warning">
              המספר נמוך מהקריאה הקודמת ({formatMileage(vehicle.mileage)}) — ודא/י שהקילומטרים הוזנו נכון.
            </p>
          ) : null}
        </div>
      </FormDialog>
    </>
  );
}

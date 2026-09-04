"use client";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DictateButton } from "@/components/ui/dictate-button";
import { appendDictatedText } from "@/lib/dictation";
import { DateInput } from "@/components/ui/date-input";
import type { VehicleInput } from "@/lib/vehicles";

/** The create/edit field set for a vehicle — shared by the vehicles list dialog and the detail page's edit dialog. */
export default function VehicleFormFields({
  form,
  set,
}: {
  form: VehicleInput;
  set: <K extends keyof VehicleInput>(key: K, value: VehicleInput[K]) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="font-medium">שם הרכב</span>
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">יצרן / דגם</span>
          <Input value={form.make_model} onChange={(e) => set("make_model", e.target.value)} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">מספר רישוי</span>
          <Input value={form.license_plate} onChange={(e) => set("license_plate", e.target.value)} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">שנת ייצור</span>
          <Input inputMode="numeric" value={form.year} onChange={(e) => set("year", e.target.value)} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">טסט הבא</span>
          <DateInput value={form.test_due_date} onChange={(e) => set("test_due_date", e.target.value)} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">ביטוח עד</span>
          <DateInput value={form.insurance_due_date} onChange={(e) => set("insurance_due_date", e.target.value)} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">רישוי עד</span>
          <DateInput value={form.license_due_date} onChange={(e) => set("license_due_date", e.target.value)} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">רשום על שם</span>
          <Input value={form.owner_name} onChange={(e) => set("owner_name", e.target.value)} />
        </label>
      </div>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">הערות</span>
        <div className="relative">
          <Textarea rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} className="pe-11" />
          <DictateButton
            onTranscript={(text) => set("notes", appendDictatedText(form.notes, text))}
            className="absolute bottom-1 end-1 h-8 w-8"
          />
        </div>
      </label>
    </div>
  );
}

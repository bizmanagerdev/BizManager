"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SpinnerIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { DateTimeInput } from "@/components/ui/date-input";
import { Textarea } from "@/components/ui/textarea";
import { DictateButton } from "@/components/ui/dictate-button";
import { appendDictatedText } from "@/lib/dictation";
import { toHebrewError } from "@/lib/error-messages";
import type { MyShiftReport } from "@/lib/attendance/my-shift";
import { updatePendingPhoneReport } from "@/lib/attendance/phoneReportActions";
import { scheduleDeferredEdit } from "@/lib/undo-engine";

/** Only what the editor actually reads — lets an admin-side report type (which
 *  has no `status`) be passed in alongside the worker's own MyShiftReport. */
type EditableReport = Pick<MyShiftReport, "id" | "clock_in" | "clock_out" | "notes">;

/** An ISO instant as a datetime-local value, to prefill the editor. */
function isoToLocal(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Editing a report still waiting in the queue — a plain update, since nothing
 * has reached payroll yet (contrast useSessionEdit, which withdraws an already
 * APPROVED shift and re-queues it). Same shape as that hook on purpose, so a
 * shift's edit form looks and behaves the same whether it's pending or approved.
 *
 * `mode` defaults to "self" (the worker's own self-service route — server-
 * routed, since it enforces a backdate limit and auto-translates Arabic
 * notes). The admin queue (PendingReportCard) passes "admin" instead, which
 * writes straight to Supabase (RLS: "Staff manage phone attendance reports"
 * already scopes this to admin/office) and skips the self-report backdate
 * limit the worker route enforces.
 */
export function usePendingReportEdit(report: EditableReport, mode: "self" | "admin" = "self") {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [startLocal, setStartLocal] = useState("");
  const [endLocal, setEndLocal] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  function openEditor() {
    setStartLocal(isoToLocal(report.clock_in));
    setEndLocal(isoToLocal(report.clock_out));
    setNote(report.notes ?? "");
    setError("");
    setEditing(true);
  }

  function save() {
    const start = startLocal ? new Date(startLocal) : null;
    const end = endLocal ? new Date(endLocal) : null;
    if (!start || Number.isNaN(start.getTime())) return setError("שעת התחלה אינה תקינה.");
    if (!end || Number.isNaN(end.getTime())) return setError("שעת סיום אינה תקינה.");
    if (end <= start) return setError("שעת הסיום חייבת להיות אחרי שעת ההתחלה.");

    setError("");
    const reportId = report.id;
    const noteSnapshot = note.trim();
    // Admin edits patch the SAME "phone-report-pending" scope the queue page
    // overlays (AttendanceQueuePanel/PendingReportCard) so the corrected times
    // show immediately there; the worker's own view has no such list here yet,
    // so the patch is simply inert until the real commit + refresh land.
    const scope = mode === "admin" ? "phone-report-pending" : "my-pending-report";
    setEditing(false);
    scheduleDeferredEdit({
      scope,
      id: reportId,
      message: "הדיווח עודכן.",
      patch: { clock_in: start.toISOString(), clock_out: end.toISOString(), notes: noteSnapshot || null },
      onCommit: async () => {
        if (mode === "admin") {
          const result = await updatePendingPhoneReport(reportId, start, end, noteSnapshot);
          if (!result.ok) return { ok: false, error: toHebrewError(result.error, "עדכון הדיווח נכשל.") };
        } else {
          const response = await fetch("/api/attendance/my/pending-report-edit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              report_id: reportId,
              clock_in: start.toISOString(),
              clock_out: end.toISOString(),
              notes: noteSnapshot || null,
            }),
          });
          const json = (await response.json().catch(() => ({}))) as { error?: string };
          if (!response.ok) return { ok: false, error: toHebrewError(json.error ?? "", "עדכון הדיווח נכשל.") };
        }
        router.refresh();
        return { ok: true };
      },
    });
  }

  return {
    editing,
    working: false,
    error,
    startLocal,
    endLocal,
    note,
    setStartLocal,
    setEndLocal,
    setNote,
    openEditor,
    closeEditor: () => setEditing(false),
    save,
  };
}

export type PendingReportEditState = ReturnType<typeof usePendingReportEdit>;

/** The edit form itself — identical on phone and desktop. */
export function PendingReportEditFields({ state }: { state: PendingReportEditState }) {
  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="block text-xs text-muted-foreground">שעת התחלה</span>
          <DateTimeInput
            value={state.startLocal}
            onChange={(e) => state.setStartLocal(e.target.value)}
            disabled={state.working}
          />
        </label>
        <label className="block space-y-1">
          <span className="block text-xs text-muted-foreground">שעת סיום</span>
          <DateTimeInput
            value={state.endLocal}
            onChange={(e) => state.setEndLocal(e.target.value)}
            disabled={state.working}
          />
        </label>
      </div>
      <label className="block space-y-1">
        <span className="block text-xs text-muted-foreground">הערה</span>
        <div className="relative">
          <Textarea
            value={state.note}
            onChange={(e) => state.setNote(e.target.value)}
            rows={2}
            disabled={state.working}
            className="pe-11"
          />
          <DictateButton
            onTranscript={(text) => state.setNote(appendDictatedText(state.note, text))}
            disabled={state.working}
            className="absolute bottom-1 end-1 h-8 w-8"
          />
        </div>
      </label>
      {state.error ? <div className="text-xs text-destructive">{state.error}</div> : null}
      <div className="flex gap-2">
        <Button type="button" size="sm" className="flex-1 sm:flex-none" disabled={state.working} onClick={() => void state.save()}>
          {state.working ? <SpinnerIcon className="h-4 w-4 animate-spin" /> : null}
          שמירה
        </Button>
        <Button type="button" size="sm" variant="secondary" disabled={state.working} onClick={state.closeEditor}>
          ביטול
        </Button>
      </div>
    </div>
  );
}

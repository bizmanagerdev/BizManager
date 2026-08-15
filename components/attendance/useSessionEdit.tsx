"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { SpinnerIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { DateTimeInput } from "@/components/ui/date-input";
import { Textarea } from "@/components/ui/textarea";
import { toHebrewError } from "@/lib/error-messages";
import type { WorkSessionRow } from "@/lib/payroll";

/** An ISO instant as a datetime-local value, to prefill the editor. */
function isoToLocal(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Correcting an approved shift — the behaviour, shared by the phone card and the
 * desktop table so the two can't drift.
 *
 * It is not an update: the session is withdrawn from payroll and the corrected
 * times go back to the boss's queue (request_attendance_session_edit). The form
 * says so out loud, because "save" here means something different from "save"
 * anywhere else in the app.
 */
export function useSessionEdit(session: WorkSessionRow) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saving, startSaving] = useTransition();
  const [busy, setBusy] = useState(false);
  const [startLocal, setStartLocal] = useState("");
  const [endLocal, setEndLocal] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const working = busy || saving;

  function openEditor() {
    setStartLocal(isoToLocal(session.clock_in));
    setEndLocal(isoToLocal(session.clock_out));
    setNote("");
    setError("");
    setEditing(true);
  }

  async function save() {
    const start = startLocal ? new Date(startLocal) : null;
    const end = endLocal ? new Date(endLocal) : null;
    if (!start || Number.isNaN(start.getTime())) return setError("שעת התחלה אינה תקינה.");
    if (!end || Number.isNaN(end.getTime())) return setError("שעת סיום אינה תקינה.");
    if (end <= start) return setError("שעת הסיום חייבת להיות אחרי שעת ההתחלה.");

    setError("");
    setBusy(true);
    try {
      const response = await fetch("/api/attendance/my/session-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: session.id,
          clock_in: start.toISOString(),
          clock_out: end.toISOString(),
          notes: note.trim() || null,
        }),
      });
      const json = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(toHebrewError(json.error ?? "", "עדכון המשמרת נכשל."));
        return;
      }
      setEditing(false);
      toast.success("התיקון נשלח לאישור הלר.");
      startSaving(() => router.refresh());
    } catch (err: unknown) {
      setError(toHebrewError(err, "אין חיבור לשרת."));
    } finally {
      setBusy(false);
    }
  }

  return {
    editing,
    working,
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

export type SessionEditState = ReturnType<typeof useSessionEdit>;

/** The correction form itself — identical on phone and desktop. */
export function SessionEditFields({ state }: { state: SessionEditState }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        תיקון מוציא את המשמרת מהשכר ושולח אותה לאישור הלר מחדש.
      </p>
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
        <span className="block text-xs text-muted-foreground">למה השינוי?</span>
        <Textarea
          value={state.note}
          onChange={(e) => state.setNote(e.target.value)}
          rows={2}
          disabled={state.working}
        />
      </label>
      {state.error ? <div className="text-xs text-destructive">{state.error}</div> : null}
      <div className="flex gap-2">
        <Button type="button" size="sm" className="flex-1 sm:flex-none" disabled={state.working} onClick={() => void state.save()}>
          {state.working ? <SpinnerIcon className="h-4 w-4 animate-spin" /> : null}
          שליחה לאישור
        </Button>
        <Button type="button" size="sm" variant="secondary" disabled={state.working} onClick={state.closeEditor}>
          ביטול
        </Button>
      </div>
    </div>
  );
}

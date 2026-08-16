"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ClockIcon, SpinnerIcon } from "@/components/ui/icons";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Textarea } from "@/components/ui/textarea";
import { DateTimeInput } from "@/components/ui/date-input";
import { formatMinutes, minutesBetween } from "@/lib/payroll";
import { formatShortDateTime } from "@/lib/date";
import { toHebrewError } from "@/lib/error-messages";

export type AttendanceLogWorker = { id: string; label: string };

type OpenState = { id: string; clock_in: string } | null;

/** Current local time as a datetime-local value ("YYYY-MM-DDTHH:mm"). */
function nowLocal() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** An ISO timestamp as a local datetime-local value, to prefill an editor with an existing time. */
function isoToLocal(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Quick "log attendance for a worker" dialog — the LOG-TO-QUEUE path (distinct from the admin
 * classify-and-create-a-real-session flow). Pick a worker, see whether they're currently clocked
 * in, then sign in / sign out / record a whole shift. Everything lands in the phone-attendance
 * pending queue for the boss to classify + approve.
 */
export function AttendanceLogDialog({
  open,
  onOpenChange,
  workers,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workers: AttendanceLogWorker[];
  onSaved?: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="space-y-1 text-start">
          <DialogTitle className="flex items-center gap-2">
            <ClockIcon className="h-5 w-5 text-secondary" />
            דיווח נוכחות לעובד
          </DialogTitle>
          <DialogDescription>בחרו עובד, ואז דווחו כניסה או יציאה — הדיווח ייכנס לתור לשיוך תחום ואישור.</DialogDescription>
        </DialogHeader>
        {/* Body unmounts on close (DialogContent unmounts), so every open starts fresh. */}
        <AttendanceLogBody workers={workers} onSaved={onSaved} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function AttendanceLogBody({
  workers,
  onSaved,
  onClose,
}: {
  workers: AttendanceLogWorker[];
  onSaved?: () => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [workerId, setWorkerId] = useState("");
  const [state, setState] = useState<OpenState>(null);
  const [stateLoaded, setStateLoaded] = useState(false);
  const [stateLoading, setStateLoading] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [customOut, setCustomOut] = useState(false);
  const [editEntry, setEditEntry] = useState(false);
  const [startLocal, setStartLocal] = useState(() => nowLocal());
  const [endLocal, setEndLocal] = useState("");
  const [outLocal, setOutLocal] = useState(() => nowLocal());
  const [entryLocal, setEntryLocal] = useState("");
  /** "מה העובד עשה" — the same write-up the worker gives on his own clock-out. */
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const workerOptions = useMemo(() => workers.map((w) => ({ value: w.id, label: w.label })), [workers]);
  // You picked a name from a dropdown and the dialog closes on save, so the
  // confirmation has to say WHO it landed on — otherwise clocking in the wrong
  // colleague looks exactly like clocking in the right one.
  const workerLabel = useMemo(
    () => workers.find((w) => w.id === workerId)?.label ?? "העובד",
    [workers, workerId]
  );

  // Load the worker's current state on selection (in the event handler — not an effect).
  function selectWorker(next: string) {
    setWorkerId(next);
    setError("");
    setManualMode(false);
    setCustomOut(false);
    setEditEntry(false);
    setNote("");
    setState(null);
    setStateLoaded(false);
    if (!next) return;
    setStateLoading(true);
    fetch(`/api/attendance/phone-reports/worker-state?user_id=${encodeURIComponent(next)}`)
      .then((r) => r.json().catch(() => ({})))
      .then((json: { open?: OpenState }) => {
        setState(json.open ?? null);
        setStateLoaded(true);
      })
      .catch(() => setError("שגיאה בטעינת מצב העובד."))
      .finally(() => setStateLoading(false));
  }

  function afterSuccess(message: string) {
    toast.success(message);
    onSaved?.();
    router.refresh();
    onClose();
  }

  function post(url: string, body: unknown, successMsg: string, failMsg: string) {
    setError("");
    startTransition(async () => {
      try {
        const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) return setError(toHebrewError(json.error, failMsg));
        afterSuccess(successMsg);
      } catch (err: unknown) {
        setError(toHebrewError(err, failMsg));
      }
    });
  }

  function signInNow() {
    post(
      "/api/attendance/phone-reports/manual",
      { user_id: workerId, clock_in: new Date().toISOString(), clock_out: null },
      `נפתחה משמרת עבור ${workerLabel}.`,
      "דיווח הכניסה נכשל."
    );
  }

  function signOut(atLocal: string) {
    const d = new Date(atLocal);
    if (!atLocal || Number.isNaN(d.getTime())) return setError("שעת יציאה אינה תקינה.");
    post(
      "/api/attendance/phone-reports/close",
      { report_id: state?.id, clock_out: d.toISOString(), notes: note.trim() || null },
      `המשמרת של ${workerLabel} נסגרה וממתינה לאישור.`,
      "דיווח היציאה נכשל."
    );
  }

  function saveEntry() {
    const d = new Date(entryLocal);
    if (!entryLocal || Number.isNaN(d.getTime())) return setError("שעת כניסה אינה תקינה.");
    if (d.getTime() > Date.now() + 60_000) return setError("שעת הכניסה לא יכולה להיות בעתיד.");
    setError("");
    startTransition(async () => {
      try {
        const res = await fetch("/api/attendance/phone-reports/update-entry", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ report_id: state?.id, clock_in: d.toISOString() }),
        });
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) return setError(toHebrewError(json.error, "עדכון שעת הכניסה נכשל."));
        toast.success(`שעת הכניסה של ${workerLabel} עודכנה.`);
        onSaved?.();
        router.refresh();
        setEditEntry(false);
        selectWorker(workerId); // re-load state so the shown entry time updates
      } catch (err: unknown) {
        setError(toHebrewError(err, "עדכון שעת הכניסה נכשל."));
      }
    });
  }

  function submitManual() {
    const cin = new Date(startLocal);
    if (!startLocal || Number.isNaN(cin.getTime())) return setError("שעת כניסה אינה תקינה.");
    let coutIso: string | null = null;
    if (endLocal) {
      const cout = new Date(endLocal);
      if (Number.isNaN(cout.getTime())) return setError("שעת יציאה אינה תקינה.");
      if (cout <= cin) return setError("שעת היציאה חייבת להיות אחרי הכניסה.");
      coutIso = cout.toISOString();
    }
    post(
      "/api/attendance/phone-reports/manual",
      { user_id: workerId, clock_in: cin.toISOString(), clock_out: coutIso, notes: note.trim() || null },
      coutIso
        ? `המשמרת של ${workerLabel} נוספה וממתינה לאישור.`
        : `נפתחה משמרת עבור ${workerLabel}.`,
      "ההוספה נכשלה."
    );
  }

  return (
    <div className="space-y-3">
      <SearchableSelect options={workerOptions} value={workerId} onChange={selectWorker} placeholder="בחירת עובד" ariaLabel="עובד" />

      {workerId && stateLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <SpinnerIcon className="h-4 w-4 animate-spin" />
          טוען מצב נוכחות...
        </div>
      ) : null}

      {workerId && stateLoaded && state ? (
        <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
          <p className="text-sm">
            <span className="font-medium text-secondary">כרגע במשמרת</span> · נכנס {formatShortDateTime(state.clock_in)} · כבר{" "}
            {formatMinutes(minutesBetween(state.clock_in, new Date()))} ש׳
          </p>
          {/* The same question the worker answers on his own clock-out
              ("מה עשית במשמרת?"), so a shift closed for him doesn't reach the
              approval queue with nothing written on it. */}
          <label className="block space-y-1">
            <span className="block text-xs text-muted-foreground">מה העובד עשה במשמרת?</span>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} disabled={isPending} />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={() => signOut(nowLocal())} disabled={isPending}>
              {isPending ? "..." : "יציאה"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setCustomOut((v) => !v)} disabled={isPending}>
              בשעה אחרת
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setError("");
                setEntryLocal(isoToLocal(state.clock_in));
                setEditEntry((v) => !v);
              }}
              disabled={isPending}
            >
              עריכת כניסה
            </Button>
          </div>
          {customOut ? (
            <div className="flex flex-wrap items-center gap-2">
              <div className="w-44">
                <DateTimeInput value={outLocal} onChange={(e) => setOutLocal(e.target.value)} />
              </div>
              <Button type="button" onClick={() => signOut(outLocal)} disabled={isPending}>
                סגירה
              </Button>
            </div>
          ) : null}
          {editEntry ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">שעת כניסה:</span>
              <div className="w-44">
                <DateTimeInput value={entryLocal} onChange={(e) => setEntryLocal(e.target.value)} />
              </div>
              <Button type="button" onClick={saveEntry} disabled={isPending}>
                שמור
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {workerId && stateLoaded && !state ? (
        <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
          <p className="text-sm text-muted-foreground">כרגע לא במשמרת.</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={signInNow} disabled={isPending}>
              {isPending ? "..." : "כניסה"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setManualMode((v) => !v)} disabled={isPending}>
              רישום ידני
            </Button>
          </div>
          {manualMode ? (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">כניסה</span>
                  <DateTimeInput value={startLocal} onChange={(e) => setStartLocal(e.target.value)} />
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">יציאה (לא חובה)</span>
                  <DateTimeInput value={endLocal} onChange={(e) => setEndLocal(e.target.value)} />
                </label>
              </div>
              <label className="block space-y-1">
                <span className="block text-xs text-muted-foreground">מה העובד עשה במשמרת?</span>
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} disabled={isPending} />
              </label>
              <div className="flex justify-end">
                <Button type="button" onClick={submitManual} disabled={isPending}>
                  {isPending ? "..." : "שמירה"}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

export default AttendanceLogDialog;

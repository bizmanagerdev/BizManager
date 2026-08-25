"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { SpinnerIcon } from "@/components/ui/icons";
import { Dialog, DialogDescription, DialogHeader, DialogTitle, FullScreenDialogContent } from "@/components/ui/dialog";
import { useSwipeToDismiss } from "@/components/ui/dialog-chrome";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Textarea } from "@/components/ui/textarea";
import { DateTimeInput } from "@/components/ui/date-input";
import { formatMinutes, minutesBetween } from "@/lib/payroll";
import { formatShortDateTime } from "@/lib/date";
import { toHebrewError } from "@/lib/error-messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/types";
import { commonDict } from "@/lib/i18n/dictionaries/common";
import { profileDict } from "@/lib/i18n/dictionaries/profile";

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
  locale = "he",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workers: AttendanceLogWorker[];
  onSaved?: () => void;
  /** Office/admin are always "he"; only a worker ever sees "ar". */
  locale?: Locale;
}) {
  // This dialog has no separate DialogChromeBody — the whole box scrolls as
  // one, so the swipe-to-dismiss gate reads scrollTop off the SAME node the
  // touch handlers are on (see FullScreenDialogContent's ref, not a nested
  // body ref like FormDialog/StepWizardDialog use).
  const contentRef = useRef<HTMLDivElement>(null);
  const swipeProps = useSwipeToDismiss({
    enabled: true,
    bodyRef: contentRef,
    onDismiss: () => onOpenChange(false),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* FullScreenDialogContent carries no default padding (unlike the old
          DialogContent's p-6) since FormDialog/StepWizard put padding on their
          own inner header/body/footer bands instead — this dialog has no such
          bands, so it has to bring its own. */}
      <FullScreenDialogContent
        ref={contentRef}
        className="overflow-y-auto p-4 sm:max-h-[90vh] sm:max-w-md sm:p-6"
        {...swipeProps}
      >
        <div className="mx-auto -mt-1 mb-1 h-1 w-10 rounded-full bg-muted-foreground/30 sm:hidden" aria-hidden />
        {/* Centered plain, no WizardTitle spacer trick — this dialog's close X is
            absolutely positioned (FullScreenDialogContent's own default), not an
            inline flex sibling like DialogChromeHeader's, so there's no reserved
            width to compensate for; a full-width text-center already lands true. */}
        <DialogHeader className="space-y-0.5">
          <DialogTitle className="text-center text-base font-semibold">
            {t(profileDict, locale, "logAttendanceTitle")}
          </DialogTitle>
          <DialogDescription className="sr-only">{t(profileDict, locale, "logAttendanceDescription")}</DialogDescription>
        </DialogHeader>
        {/* Body unmounts on close (DialogContent unmounts), so every open starts fresh. */}
        <AttendanceLogBody workers={workers} onSaved={onSaved} onClose={() => onOpenChange(false)} locale={locale} />
      </FullScreenDialogContent>
    </Dialog>
  );
}

function AttendanceLogBody({
  workers,
  onSaved,
  onClose,
  locale,
}: {
  workers: AttendanceLogWorker[];
  onSaved?: () => void;
  onClose: () => void;
  locale: Locale;
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
    () => workers.find((w) => w.id === workerId)?.label ?? t(profileDict, locale, "theWorkerFallback"),
    [workers, workerId, locale]
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
      .catch(() => setError(t(profileDict, locale, "errLoadWorkerState")))
      .finally(() => setStateLoading(false));
  }

  // When the picker has been narrowed to just one worker (an Arabic-locale
  // worker logging only his own attendance — see QuickCreateDialogs), skip the
  // redundant "pick yourself from a list of one" step. The body remounts fresh
  // on every dialog open, so this only ever fires once per open.
  useEffect(() => {
    if (workers.length === 1) selectWorker(workers[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      t(profileDict, locale, "shiftOpenedForTemplate").replace("{name}", workerLabel),
      t(profileDict, locale, "clockInReportFailed")
    );
  }

  function signOut(atLocal: string) {
    const d = new Date(atLocal);
    if (!atLocal || Number.isNaN(d.getTime())) return setError(t(profileDict, locale, "errInvalidClockOutTime"));
    post(
      "/api/attendance/phone-reports/close",
      { report_id: state?.id, clock_out: d.toISOString(), notes: note.trim() || null },
      t(profileDict, locale, "shiftClosedForTemplate").replace("{name}", workerLabel),
      t(profileDict, locale, "clockOutReportFailed")
    );
  }

  function saveEntry() {
    const d = new Date(entryLocal);
    if (!entryLocal || Number.isNaN(d.getTime())) return setError(t(profileDict, locale, "errInvalidClockInTime"));
    if (d.getTime() > Date.now() + 60_000) return setError(t(profileDict, locale, "errClockInFuture"));
    setError("");
    startTransition(async () => {
      try {
        const res = await fetch("/api/attendance/phone-reports/update-entry", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ report_id: state?.id, clock_in: d.toISOString() }),
        });
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) return setError(toHebrewError(json.error, t(profileDict, locale, "updateClockInFailed")));
        toast.success(t(profileDict, locale, "clockInUpdatedTemplate").replace("{name}", workerLabel));
        onSaved?.();
        router.refresh();
        setEditEntry(false);
        selectWorker(workerId); // re-load state so the shown entry time updates
      } catch (err: unknown) {
        setError(toHebrewError(err, t(profileDict, locale, "updateClockInFailed")));
      }
    });
  }

  function submitManual() {
    const cin = new Date(startLocal);
    if (!startLocal || Number.isNaN(cin.getTime())) return setError(t(profileDict, locale, "errInvalidClockInTime"));
    let coutIso: string | null = null;
    if (endLocal) {
      const cout = new Date(endLocal);
      if (Number.isNaN(cout.getTime())) return setError(t(profileDict, locale, "errInvalidClockOutTime"));
      if (cout <= cin) return setError(t(profileDict, locale, "errClockOutAfterClockIn"));
      coutIso = cout.toISOString();
    }
    post(
      "/api/attendance/phone-reports/manual",
      { user_id: workerId, clock_in: cin.toISOString(), clock_out: coutIso, notes: note.trim() || null },
      coutIso
        ? t(profileDict, locale, "shiftAddedForTemplate").replace("{name}", workerLabel)
        : t(profileDict, locale, "shiftOpenedForTemplate").replace("{name}", workerLabel),
      t(profileDict, locale, "addFailedGeneric")
    );
  }

  return (
    <div className="space-y-3">
      <SearchableSelect options={workerOptions} value={workerId} onChange={selectWorker} placeholder={t(profileDict, locale, "selectWorkerPlaceholder")} ariaLabel={t(profileDict, locale, "workerAriaLabel")} />

      {workerId && stateLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <SpinnerIcon className="h-4 w-4 animate-spin" />
          {t(profileDict, locale, "loadingAttendanceState")}
        </div>
      ) : null}

      {workerId && stateLoaded && state ? (
        <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
          <p className="text-sm">
            <span className="font-medium text-secondary">{t(profileDict, locale, "currentlyOnShiftLabel")}</span>{t(profileDict, locale, "clockedInAtPrefix")}{formatShortDateTime(state.clock_in)}{t(profileDict, locale, "alreadyPrefix")}
            {formatMinutes(minutesBetween(state.clock_in, new Date()))} {t(profileDict, locale, "hoursShort")}
          </p>
          {/* The same question the worker answers on his own clock-out
              ("מה עשית במשמרת?"), so a shift closed for him doesn't reach the
              approval queue with nothing written on it. */}
          <label className="block space-y-1">
            <span className="block text-xs text-muted-foreground">{t(profileDict, locale, "whatDidWorkerDoLabel")}</span>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} disabled={isPending} />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={() => signOut(nowLocal())} disabled={isPending}>
              {isPending ? t(profileDict, locale, "loadingEllipsis") : t(profileDict, locale, "exitLabel")}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setCustomOut((v) => !v)} disabled={isPending}>
              {t(profileDict, locale, "atOtherTimeLabel")}
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
              {t(profileDict, locale, "editClockInLabel")}
            </Button>
          </div>
          {customOut ? (
            <div className="flex flex-wrap items-center gap-2">
              <div className="w-44">
                <DateTimeInput value={outLocal} onChange={(e) => setOutLocal(e.target.value)} />
              </div>
              <Button type="button" onClick={() => signOut(outLocal)} disabled={isPending}>
                {t(profileDict, locale, "closeShort")}
              </Button>
            </div>
          ) : null}
          {editEntry ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">{t(profileDict, locale, "clockInTimeLabelColon")}</span>
              <div className="w-44">
                <DateTimeInput value={entryLocal} onChange={(e) => setEntryLocal(e.target.value)} />
              </div>
              <Button type="button" onClick={saveEntry} disabled={isPending}>
                {t(profileDict, locale, "saveShortLabel")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {workerId && stateLoaded && !state ? (
        <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
          <p className="text-sm text-muted-foreground">{t(profileDict, locale, "notCurrentlyOnShift")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={signInNow} disabled={isPending}>
              {isPending ? t(profileDict, locale, "loadingEllipsis") : t(profileDict, locale, "entryLabel")}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setManualMode((v) => !v)} disabled={isPending}>
              {t(profileDict, locale, "manualEntryLabel")}
            </Button>
          </div>
          {manualMode ? (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">{t(profileDict, locale, "entryLabel")}</span>
                  <DateTimeInput value={startLocal} onChange={(e) => setStartLocal(e.target.value)} />
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">{t(profileDict, locale, "exitOptionalLabel")}</span>
                  <DateTimeInput value={endLocal} onChange={(e) => setEndLocal(e.target.value)} />
                </label>
              </div>
              <label className="block space-y-1">
                <span className="block text-xs text-muted-foreground">{t(profileDict, locale, "whatDidWorkerDoLabel")}</span>
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} disabled={isPending} />
              </label>
              <div className="flex justify-end">
                <Button type="button" onClick={submitManual} disabled={isPending}>
                  {isPending ? t(profileDict, locale, "loadingEllipsis") : t(commonDict, locale, "save")}
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

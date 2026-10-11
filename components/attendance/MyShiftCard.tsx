"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ClockIcon, SpinnerIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { DateTimeInput } from "@/components/ui/date-input";
import { DictateButton } from "@/components/ui/dictate-button";
import { appendDictatedText } from "@/lib/dictation";
import { formatMinutes, minutesBetween } from "@/lib/payroll";
import { formatShortDateTime } from "@/lib/date";
import { toHebrewError } from "@/lib/error-messages";
import type { MyShiftReport } from "@/lib/attendance/my-shift";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/types";
import { commonDict } from "@/lib/i18n/dictionaries/common";
import { profileDict } from "@/lib/i18n/dictionaries/profile";
import { scheduleDeferredAction } from "@/lib/undo-engine";
import { IsraelTimeNote } from "@/components/ui/israel-time-note";
import { israelLocalValueToIso, nowIsraelLocalValue } from "@/lib/timezone";
import { offlineFetch } from "@/lib/offline-queue";
import { readyLocalDatabase } from "@/lib/powersync/store";
import { localClient } from "@/lib/powersync/local-results";

// A clock-in made with no signal waits in the send queue (owner, 2026-10-11:
// "it would be nice if it could be offline"), and is kept here meanwhile so
// the card shows the shift as open — after a reload too — until the server's
// own copy has it. Cleared once the server shows an open shift, or after a day.
const PENDING_SHIFT_KEY = "bizh-pending-shift";
const PENDING_SHIFT_EVENT = "bizh:pending-shift";
const PENDING_SHIFT_KEEP_MS = 20 * 60 * 60 * 1000;
type PendingShift = { clock_in: string; notes: string | null; at: number };

function readPendingShift(): string {
  try {
    const raw = localStorage.getItem(PENDING_SHIFT_KEY);
    if (!raw) return "";
    const parsed = JSON.parse(raw) as PendingShift;
    return Date.now() - parsed.at < PENDING_SHIFT_KEEP_MS ? raw : "";
  } catch {
    return "";
  }
}

function writePendingShift(next: PendingShift | null) {
  try {
    if (next) localStorage.setItem(PENDING_SHIFT_KEY, JSON.stringify(next));
    else localStorage.removeItem(PENDING_SHIFT_KEY);
  } catch {
    // Storage blocked: the card shows it once the server has it.
  }
  window.dispatchEvent(new Event(PENDING_SHIFT_EVENT));
}

function subscribePendingShift(onChange: () => void) {
  window.addEventListener(PENDING_SHIFT_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(PENDING_SHIFT_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Is there a shift open for this person on the phone's copy (their own reports — sync rules v1.10)? */
async function openShiftOnDevice(userId: string | undefined): Promise<boolean> {
  const db = readyLocalDatabase();
  if (!db || !userId) return false;
  try {
    const { data } = await (await localClient(db))
      .from("phone_attendance_reports")
      .select("id")
      .eq("user_id", userId)
      .eq("status", "open")
      .limit(1);
    return Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

/**
 * The worker's own clock: open a shift, and when the day is done submit it.
 *
 * There is no business-domain picker here on purpose — the worker reports WHEN
 * he worked, the boss decides WHAT it was against when approving in /payroll.
 * The optional note is the one thing he can add to help that call.
 */
export default function MyShiftCard({
  openShift: openShiftProp,
  pendingCount,
  locale = "he",
  userId,
}: {
  openShift: MyShiftReport | null;
  /** Whose clock this is — to check the phone's copy for an open shift before a clock-in with no signal. */
  userId?: string;
  /** Submitted shifts still waiting for the boss, so he knows it went through. */
  pendingCount: number;
  /** Office/admin are always "he"; only a worker ever sees "ar". */
  locale?: Locale;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [saving, startSaving] = useTransition();
  const [busy, setBusy] = useState(false);
  // Closing is deferred (see closeShift): the card reflects "not on shift"
  // immediately, before the real close call has actually gone out.
  const [closedOptimistically, setClosedOptimistically] = useState(false);
  // A clock-in still waiting for the connection, shown as the open shift
  // until the server's own copy has one.
  const pendingRaw = useSyncExternalStore(subscribePendingShift, readPendingShift, () => "");
  useEffect(() => {
    if (openShiftProp && pendingRaw) writePendingShift(null);
  }, [openShiftProp, pendingRaw]);
  // Built once per stored entry: the minute ticker below restarts whenever the
  // open shift is a new object, and a new one every render never settles.
  const pendingOpen = useMemo<MyShiftReport | null>(() => {
    if (!pendingRaw) return null;
    const pendingShift = JSON.parse(pendingRaw) as PendingShift;
    return {
      id: "pending",
      clock_in: pendingShift.clock_in,
      clock_out: null,
      worked_minutes: null,
      status: "open",
      source: "app",
      notes: pendingShift.notes,
      created_at: new Date(pendingShift.at).toISOString(),
    };
  }, [pendingRaw]);
  const openShift = closedOptimistically ? null : (openShiftProp ?? pendingOpen);
  // "עכשיו" or a time he types in — a driver who only remembers to clock in at
  // 10:00 shouldn't lose the two hours he already worked, and one who remembers
  // to clock out at 20:00 shouldn't be paid for the three he spent at home.
  // "full" is the third case: he never touched the app that day and is reporting
  // the whole shift after the fact.
  const [startMode, setStartMode] = useState<"now" | "custom" | "full">("now");
  const [startLocal, setStartLocal] = useState("");
  const [fullEndLocal, setFullEndLocal] = useState("");
  const [endMode, setEndMode] = useState<"now" | "custom">("now");
  const [endLocal, setEndLocal] = useState("");
  // The closing form is behind a press — an open shift shouldn't sit there with
  // a half-filled form on screen all day.
  const [closing, setClosing] = useState(false);

  // Ticks the elapsed reading once a minute — the shift is measured in minutes,
  // so a per-second timer would only burn battery on a phone in a van.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!openShift) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [openShift]);

  const elapsedMinutes =
    openShift && now ? minutesBetween(openShift.clock_in, new Date(now)) : null;

  function resetForm() {
    setNote("");
    setStartMode("now");
    setStartLocal("");
    setFullEndLocal("");
    setEndMode("now");
    setEndLocal("");
    setClosing(false);
  }

  async function call(path: string, successMessage: string, extra?: Record<string, unknown>) {
    setBusy(true);
    try {
      // No signal: into the send queue with the time it was pressed (the
      // server would otherwise take its own "now", hours later). A clock-in
      // first checks the phone's copy for a shift already open, and then shows
      // as open at once (PENDING_SHIFT_KEY).
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        const isStart = path === "/api/attendance/my/start";
        if (isStart && (await openShiftOnDevice(userId))) {
          toast.error(t(profileDict, locale, "shiftAlreadyOpen"));
          return;
        }
        const notes = note.trim() || null;
        const pressedAt = new Date().toISOString();
        const body: Record<string, unknown> = isStart ? { notes, clock_in: pressedAt, ...extra } : { notes, ...extra };
        const result = await offlineFetch(path, body, isStart ? "פתיחת המשמרת" : "דיווח המשמרת");
        if (!result.queued && !result.ok) {
          toast.error(toHebrewError(result.error ?? "", t(profileDict, locale, "actionFailed")));
          return;
        }
        if (isStart && result.queued) {
          writePendingShift({ clock_in: typeof body.clock_in === "string" ? body.clock_in : pressedAt, notes, at: Date.now() });
        }
        resetForm();
        toast.success(successMessage);
        return;
      }
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: note.trim() || null, ...extra }),
      });
      const json = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        toast.error(toHebrewError(json.error ?? "", t(profileDict, locale, "actionFailed")));
        return;
      }
      resetForm();
      toast.success(successMessage);
      startSaving(() => router.refresh());
    } catch (error: unknown) {
      toast.error(toHebrewError(error, t(profileDict, locale, "noServerConnection")));
    } finally {
      setBusy(false);
    }
  }

  function openShiftNow() {
    if (startMode === "now") {
      void call("/api/attendance/my/start", t(profileDict, locale, "shiftOpenedToast"));
      return;
    }
    // The field carries no timezone, so SOMETHING has to decide what "08:30"
    // means. It means 08:30 in Israel — never the phone's own clock, which for a
    // worker abroad is a different hour and used to be stored as one.
    const clockInIso = israelLocalValueToIso(startLocal);
    if (!clockInIso) {
      toast.error(t(profileDict, locale, "errSelectStartTime"));
      return;
    }
    if (startMode === "custom") {
      void call("/api/attendance/my/start", t(profileDict, locale, "shiftOpenedToast"), { clock_in: clockInIso });
      return;
    }
    // A finished shift goes straight to the boss — there's nothing left to close.
    const clockOutIso = israelLocalValueToIso(fullEndLocal);
    if (!clockOutIso) {
      toast.error(t(profileDict, locale, "errSelectEndTime"));
      return;
    }
    if (new Date(clockOutIso).getTime() <= new Date(clockInIso).getTime()) {
      toast.error(t(profileDict, locale, "errEndAfterStart"));
      return;
    }
    void call("/api/attendance/my/log", t(profileDict, locale, "shiftSubmittedToast"), {
      clock_in: clockInIso,
      clock_out: clockOutIso,
    });
  }

  function closeShift() {
    if (!openShift) return;
    let clockOutIso: string | undefined;
    if (endMode !== "now") {
      const parsed = israelLocalValueToIso(endLocal);
      if (!parsed) {
        toast.error(t(profileDict, locale, "errSelectEndTime"));
        return;
      }
      clockOutIso = parsed;
    }
    const noteSnapshot = note.trim();
    // The moment it was pressed, not when the server hears of it — a clock-out
    // that waits for a connection must still end the shift at this time.
    const endIso = clockOutIso ?? new Date().toISOString();
    setNote("");
    setEndMode("now");
    setEndLocal("");
    setClosing(false);
    scheduleDeferredAction({
      key: `phone-report:close:${openShift.id}`,
      message: t(profileDict, locale, "shiftSubmittedToast"),
      onApplyOptimistic: () => {
        setClosedOptimistically(true);
        // A clock-in still waiting to be sent is closed with it (the queue
        // sends the opening first, then this).
        if (openShift.id === "pending") writePendingShift(null);
      },
      onRevert: () => setClosedOptimistically(false),
      onCommit: async () => {
        // Through the send queue: with no signal the clock-out waits for the
        // connection instead of reverting and losing the note and end time.
        const result = await offlineFetch(
          "/api/attendance/my/close",
          { notes: noteSnapshot || null, clock_out: endIso },
          "סיום המשמרת"
        );
        if (!result.queued && !result.ok) {
          return { ok: false, error: toHebrewError(result.error ?? "", t(profileDict, locale, "actionFailed")) };
        }
        if (!result.queued) startSaving(() => router.refresh());
        return { ok: true };
      },
    });
  }

  const working = busy || saving;

  return (
    <Card>
      <CardContent className="space-y-3 py-4 text-right" dir="rtl">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* When a shift is running the heading carries the start time itself —
              a title that only said "משמרת פתוחה" with "נפתחה ב־…" repeated on
              the line below was the same fact twice. */}
          <div className="flex min-w-0 items-center gap-2 text-base font-semibold">
            <ClockIcon className="h-5 w-5 shrink-0" />
            <span>
              {openShift ? `${t(profileDict, locale, "openShiftSincePrefix")}${formatShortDateTime(openShift.clock_in)}` : t(profileDict, locale, "attendanceClockTitle")}
            </span>
          </div>
          {pendingCount > 0 ? (
            <Badge variant="warning">{t(profileDict, locale, "pendingShiftsBadgeTemplate").replace("{n}", String(pendingCount))}</Badge>
          ) : null}
        </div>

        {/* Null until the first client tick, so the server and client render the
            same markup and the running total can't hydrate-mismatch. */}
        {openShift && elapsedMinutes !== null ? (
          <div className="text-sm text-muted-foreground">{t(profileDict, locale, "elapsedPrefix")}{formatMinutes(elapsedMinutes)} {t(profileDict, locale, "hoursSuffix")}</div>
        ) : null}

        {/* While the shift just runs, the card is one line and one button. The
            closing FORM — end time and what you did — appears only once you say
            you're finishing, the same two-step the payroll queue uses to close
            someone's shift. */}
        {openShift ? (
          !closing ? (
            <Button
              type="button"
              className="w-full"
              disabled={working}
              onClick={() => {
                setEndMode("now");
                setEndLocal("");
                setClosing(true);
              }}
            >
              {t(profileDict, locale, "endShiftLabel")}
            </Button>
          ) : (
            <div className="space-y-2">
              <NativeSelect
                value={endMode}
                disabled={working}
                aria-label={t(profileDict, locale, "endTimeAriaLabel")}
                onChange={(event) => {
                  const custom = event.target.value === "custom";
                  setEndMode(custom ? "custom" : "now");
                  if (custom && !endLocal) setEndLocal(nowIsraelLocalValue());
                }}
              >
                <option value="now">{t(profileDict, locale, "finishedNowOption")}</option>
                <option value="custom">{t(profileDict, locale, "finishedOtherTimeOption")}</option>
              </NativeSelect>
              {endMode === "custom" ? (
                <DateTimeInput
                  value={endLocal}
                  onChange={(event) => setEndLocal(event.target.value)}
                  disabled={working}
                  aria-label={t(profileDict, locale, "endTimeLabel")}
                />
              ) : null}
              {endMode === "custom" ? <IsraelTimeNote locale={locale} /> : null}
              <label className="block space-y-1">
                <span className="block text-xs text-muted-foreground">{t(profileDict, locale, "whatDidYouDoLabel")}</span>
                <div className="relative">
                  <Textarea
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    rows={2}
                    disabled={working}
                    className="pe-11"
                  />
                  <DictateButton
                    onTranscript={(text) => setNote((prev) => appendDictatedText(prev, text))}
                    disabled={working}
                    className="absolute bottom-1 end-1 h-8 w-8"
                  />
                </div>
              </label>
              <div className="flex gap-2">
                <Button type="button" className="flex-1" disabled={working} onClick={closeShift}>
                  {working ? <SpinnerIcon className="h-4 w-4 animate-spin" /> : null}
                  {t(profileDict, locale, "submitForApprovalLabel")}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={working}
                  onClick={() => {
                    setClosing(false);
                    setNote("");
                  }}
                >
                  {t(commonDict, locale, "cancel")}
                </Button>
              </div>
            </div>
          )
        ) : (
          <div className="space-y-2">
            <NativeSelect
              value={startMode}
              disabled={working}
              aria-label={t(profileDict, locale, "startTimeAriaLabel")}
              onChange={(event) => {
                const value = event.target.value;
                const mode = value === "custom" || value === "full" ? value : "now";
                setStartMode(mode);
                // Prefill with the current time so he edits the hour rather than
                // typing a whole date on a phone.
                if (mode !== "now" && !startLocal) setStartLocal(nowIsraelLocalValue());
                if (mode === "full" && !fullEndLocal) setFullEndLocal(nowIsraelLocalValue());
              }}
            >
              <option value="now">{t(profileDict, locale, "startedNowOption")}</option>
              <option value="custom">{t(profileDict, locale, "startedOtherTimeOption")}</option>
              <option value="full">{t(profileDict, locale, "forgotToReportOption")}</option>
            </NativeSelect>
            {startMode !== "now" ? (
              <label className="block space-y-1">
                <span className="block text-xs text-muted-foreground">{t(profileDict, locale, "startTimeLabel")}</span>
                <DateTimeInput
                  value={startLocal}
                  onChange={(event) => setStartLocal(event.target.value)}
                  disabled={working}
                  aria-label={t(profileDict, locale, "startTimeLabel")}
                />
              </label>
            ) : null}
            {startMode !== "now" ? <IsraelTimeNote locale={locale} /> : null}
            {startMode === "full" ? (
              <>
                <label className="block space-y-1">
                  <span className="block text-xs text-muted-foreground">{t(profileDict, locale, "endTimeLabel")}</span>
                  <DateTimeInput
                    value={fullEndLocal}
                    onChange={(event) => setFullEndLocal(event.target.value)}
                    disabled={working}
                    aria-label={t(profileDict, locale, "endTimeLabel")}
                  />
                </label>
                {/* Worth asking here: a shift reported days later gives the boss
                    nothing else to go on when picking the business domain. */}
                <label className="block space-y-1">
                  <span className="block text-xs text-muted-foreground">{t(profileDict, locale, "whatDidYouDoLabel")}</span>
                  <div className="relative">
                    <Textarea
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      rows={2}
                      disabled={working}
                      className="pe-11"
                    />
                    <DictateButton
                      onTranscript={(text) => setNote((prev) => appendDictatedText(prev, text))}
                      disabled={working}
                      className="absolute bottom-1 end-1 h-8 w-8"
                    />
                  </div>
                </label>
              </>
            ) : null}
            <Button type="button" className="w-full" disabled={working} onClick={openShiftNow}>
              {working ? <SpinnerIcon className="h-4 w-4 animate-spin" /> : null}
              {startMode === "full" ? t(profileDict, locale, "submitForApprovalLabel") : t(profileDict, locale, "startShiftLabel")}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

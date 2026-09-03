"use client";

import { useEffect, useState, useTransition } from "react";
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

/** Now as a datetime-local value ("YYYY-MM-DDTHH:mm"), the format DateTimeInput reads. */
function nowLocal() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
}: {
  openShift: MyShiftReport | null;
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
  const openShift = closedOptimistically ? null : openShiftProp;
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

  async function call(path: string, successMessage: string, extra?: Record<string, unknown>) {
    setBusy(true);
    try {
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
      setNote("");
      setStartMode("now");
      setStartLocal("");
      setFullEndLocal("");
      setEndMode("now");
      setEndLocal("");
      setClosing(false);
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
    // datetime-local carries no timezone; new Date() reads it as local, which is
    // what the worker meant, and the server stores the resulting instant.
    const parsed = startLocal ? new Date(startLocal) : null;
    if (!parsed || Number.isNaN(parsed.getTime())) {
      toast.error(t(profileDict, locale, "errSelectStartTime"));
      return;
    }
    if (startMode === "custom") {
      void call("/api/attendance/my/start", t(profileDict, locale, "shiftOpenedToast"), { clock_in: parsed.toISOString() });
      return;
    }
    // A finished shift goes straight to the boss — there's nothing left to close.
    const parsedEnd = fullEndLocal ? new Date(fullEndLocal) : null;
    if (!parsedEnd || Number.isNaN(parsedEnd.getTime())) {
      toast.error(t(profileDict, locale, "errSelectEndTime"));
      return;
    }
    if (parsedEnd <= parsed) {
      toast.error(t(profileDict, locale, "errEndAfterStart"));
      return;
    }
    void call("/api/attendance/my/log", t(profileDict, locale, "shiftSubmittedToast"), {
      clock_in: parsed.toISOString(),
      clock_out: parsedEnd.toISOString(),
    });
  }

  function closeShift() {
    if (!openShift) return;
    let clockOutIso: string | undefined;
    if (endMode !== "now") {
      const parsed = endLocal ? new Date(endLocal) : null;
      if (!parsed || Number.isNaN(parsed.getTime())) {
        toast.error(t(profileDict, locale, "errSelectEndTime"));
        return;
      }
      clockOutIso = parsed.toISOString();
    }
    const noteSnapshot = note.trim();
    setNote("");
    setEndMode("now");
    setEndLocal("");
    setClosing(false);
    scheduleDeferredAction({
      key: `phone-report:close:${openShift.id}`,
      message: t(profileDict, locale, "shiftSubmittedToast"),
      onApplyOptimistic: () => setClosedOptimistically(true),
      onRevert: () => setClosedOptimistically(false),
      onCommit: async () => {
        const response = await fetch("/api/attendance/my/close", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notes: noteSnapshot || null, ...(clockOutIso ? { clock_out: clockOutIso } : {}) }),
        });
        const json = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) return { ok: false, error: toHebrewError(json.error ?? "", t(profileDict, locale, "actionFailed")) };
        startSaving(() => router.refresh());
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
            <span className="break-words">
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
                  if (custom && !endLocal) setEndLocal(nowLocal());
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
                if (mode !== "now" && !startLocal) setStartLocal(nowLocal());
                if (mode === "full" && !fullEndLocal) setFullEndLocal(nowLocal());
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

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
import { formatMinutes, minutesBetween } from "@/lib/payroll";
import { formatShortDateTime } from "@/lib/date";
import { toHebrewError } from "@/lib/error-messages";
import type { MyShiftReport } from "@/lib/attendance/my-shift";

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
  openShift,
  pendingCount,
}: {
  openShift: MyShiftReport | null;
  /** Submitted shifts still waiting for the boss, so he knows it went through. */
  pendingCount: number;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [saving, startSaving] = useTransition();
  const [busy, setBusy] = useState(false);
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
        toast.error(toHebrewError(json.error ?? "", "הפעולה נכשלה."));
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
      toast.error(toHebrewError(error, "אין חיבור לשרת."));
    } finally {
      setBusy(false);
    }
  }

  function openShiftNow() {
    if (startMode === "now") {
      void call("/api/attendance/my/start", "המשמרת נפתחה.");
      return;
    }
    // datetime-local carries no timezone; new Date() reads it as local, which is
    // what the worker meant, and the server stores the resulting instant.
    const parsed = startLocal ? new Date(startLocal) : null;
    if (!parsed || Number.isNaN(parsed.getTime())) {
      toast.error("יש לבחור שעת התחלה.");
      return;
    }
    if (startMode === "custom") {
      void call("/api/attendance/my/start", "המשמרת נפתחה.", { clock_in: parsed.toISOString() });
      return;
    }
    // A finished shift goes straight to the boss — there's nothing left to close.
    const parsedEnd = fullEndLocal ? new Date(fullEndLocal) : null;
    if (!parsedEnd || Number.isNaN(parsedEnd.getTime())) {
      toast.error("יש לבחור שעת סיום.");
      return;
    }
    if (parsedEnd <= parsed) {
      toast.error("שעת הסיום חייבת להיות אחרי שעת ההתחלה.");
      return;
    }
    void call("/api/attendance/my/log", "המשמרת נשלחה לאישור.", {
      clock_in: parsed.toISOString(),
      clock_out: parsedEnd.toISOString(),
    });
  }

  function closeShift() {
    if (endMode === "now") {
      void call("/api/attendance/my/close", "המשמרת נשלחה לאישור.");
      return;
    }
    const parsed = endLocal ? new Date(endLocal) : null;
    if (!parsed || Number.isNaN(parsed.getTime())) {
      toast.error("יש לבחור שעת סיום.");
      return;
    }
    void call("/api/attendance/my/close", "המשמרת נשלחה לאישור.", { clock_out: parsed.toISOString() });
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
              {openShift ? `משמרת פתוחה מ־${formatShortDateTime(openShift.clock_in)}` : "שעון נוכחות"}
            </span>
          </div>
          {pendingCount > 0 ? (
            <Badge variant="warning">{pendingCount} משמרות ממתינות לאישור</Badge>
          ) : null}
        </div>

        {/* Null until the first client tick, so the server and client render the
            same markup and the running total can't hydrate-mismatch. */}
        {openShift && elapsedMinutes !== null ? (
          <div className="text-sm text-muted-foreground">עד עכשיו: {formatMinutes(elapsedMinutes)} שעות</div>
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
              סיום משמרת
            </Button>
          ) : (
            <div className="space-y-2">
              <NativeSelect
                value={endMode}
                disabled={working}
                aria-label="שעת סיום המשמרת"
                onChange={(event) => {
                  const custom = event.target.value === "custom";
                  setEndMode(custom ? "custom" : "now");
                  if (custom && !endLocal) setEndLocal(nowLocal());
                }}
              >
                <option value="now">סיימתי עכשיו</option>
                <option value="custom">סיימתי בשעה אחרת</option>
              </NativeSelect>
              {endMode === "custom" ? (
                <DateTimeInput
                  value={endLocal}
                  onChange={(event) => setEndLocal(event.target.value)}
                  disabled={working}
                  aria-label="שעת סיום"
                />
              ) : null}
              <label className="block space-y-1">
                <span className="block text-xs text-muted-foreground">מה עשית במשמרת?</span>
                <Textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={2}
                  disabled={working}
                />
              </label>
              <div className="flex gap-2">
                <Button type="button" className="flex-1" disabled={working} onClick={closeShift}>
                  {working ? <SpinnerIcon className="h-4 w-4 animate-spin" /> : null}
                  שליחה לאישור
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
                  ביטול
                </Button>
              </div>
            </div>
          )
        ) : (
          <div className="space-y-2">
            <NativeSelect
              value={startMode}
              disabled={working}
              aria-label="שעת תחילת המשמרת"
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
              <option value="now">התחלתי עכשיו</option>
              <option value="custom">התחלתי בשעה אחרת</option>
              <option value="full">שכחתי לדווח — משמרת שהסתיימה</option>
            </NativeSelect>
            {startMode !== "now" ? (
              <label className="block space-y-1">
                <span className="block text-xs text-muted-foreground">שעת התחלה</span>
                <DateTimeInput
                  value={startLocal}
                  onChange={(event) => setStartLocal(event.target.value)}
                  disabled={working}
                  aria-label="שעת התחלה"
                />
              </label>
            ) : null}
            {startMode === "full" ? (
              <>
                <label className="block space-y-1">
                  <span className="block text-xs text-muted-foreground">שעת סיום</span>
                  <DateTimeInput
                    value={fullEndLocal}
                    onChange={(event) => setFullEndLocal(event.target.value)}
                    disabled={working}
                    aria-label="שעת סיום"
                  />
                </label>
                {/* Worth asking here: a shift reported days later gives the boss
                    nothing else to go on when picking the business domain. */}
                <label className="block space-y-1">
                  <span className="block text-xs text-muted-foreground">מה עשית במשמרת?</span>
                  <Textarea
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    rows={2}
                    disabled={working}
                  />
                </label>
              </>
            ) : null}
            <Button type="button" className="w-full" disabled={working} onClick={openShiftNow}>
              {working ? <SpinnerIcon className="h-4 w-4 animate-spin" /> : null}
              {startMode === "full" ? "שליחה לאישור" : "פתיחת משמרת"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

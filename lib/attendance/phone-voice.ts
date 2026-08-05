/**
 * Phone attendance — the voice/JSON layer.
 *
 * EVERYTHING the telephony provider needs to know lives here: the recording names and the exact
 * shape of the JSON we return. The provider plays our `play` list in order — each item is either
 * a pre-recorded clip (`recording`) or a number his system reads aloud (`number`). If any detail
 * of his format differs, this is the only file that changes.
 *
 * The recording set is EXACTLY the clips the user recorded — no singular/dual grammar variants, so
 * durations read as "<n> שעות" / "<n> דקות" (plural clips only).
 */

export type PlayItem = { recording: string } | { number: number };

export type VoiceResponse = {
  ok: boolean;
  hangup: boolean;
  play: PlayItem[];
  // Machine-readable outcome — for our logs/tests, ignored by the provider.
  action: string;
};

/** Canonical recording ids. The value IS the file name we ask the provider to map. */
export const RECORDINGS = {
  welcomeMenu: "welcome_menu",
  notRecognized: "not_recognized",
  notAllowed: "not_allowed",
  systemError: "system_error",
  invalidChoice: "invalid_choice",

  clockInSuccess: "clock_in_success", // "נרשמה כניסה בשעה" → HH [ו MM]
  // One clip: "ניתן לדווח יציאה בלבד. כבר רשומה לך כניסה מהשעה" → HH [ו MM]
  alreadyOpen: "already_open",

  clockOutSuccess: "clock_out_success", // "נרשמה יציאה בשעה" → HH [ו MM]
  noOpenShift: "no_open_shift", // "לא נמצאה משמרת פתוחה. יש לדווח כניסה תחילה."
  shiftDuration: "shift_duration", // "משך המשמרת" → <duration>

  // Past-shift entry (menu 3). The ask_* clips are played by the PROVIDER while collecting the four
  // keypad fields; we only ever return past_shift_saved / invalid_datetime.
  askStartDate: "ask_start_date",
  askStartTime: "ask_start_time",
  askEndDate: "ask_end_date",
  askEndTime: "ask_end_time",
  pastShiftSaved: "past_shift_saved", // "המשמרת נקלטה וממתינה לאישור המשרד."
  invalidDatetime: "invalid_datetime", // "הנתונים שהוקשו אינם תקינים. יש לנסות שוב."

  hoursWord: "hours_word", // "שעות"
  minutesWord: "minutes_word", // "דקות"
  andWord: "and_word", // "ו"
} as const;

const clip = (recording: string): PlayItem => ({ recording });
const num = (value: number): PlayItem => ({ number: value });

/** "בשעה שמונה וארבע-עשרה" / round hour → just the hour. */
export function timeSegments(hour: number, minute: number): PlayItem[] {
  const parts: PlayItem[] = [num(hour)];
  if (minute > 0) parts.push(clip(RECORDINGS.andWord), num(minute));
  return parts;
}

/** Spoken duration using plural clips only: "6 שעות ו-20 דקות", "20 דקות", "1 שעות". */
export function durationSegments(totalMinutes: number): PlayItem[] {
  const safe = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(safe / 60);
  const minutes = safe % 60;
  const parts: PlayItem[] = [];

  if (hours > 0) parts.push(num(hours), clip(RECORDINGS.hoursWord));
  if (hours > 0 && minutes > 0) parts.push(clip(RECORDINGS.andWord));
  if (minutes > 0) parts.push(num(minutes), clip(RECORDINGS.minutesWord));
  // A whole-hour shift already said the hours; a sub-minute shift says "0 דקות".
  if (hours === 0 && minutes === 0) parts.push(num(0), clip(RECORDINGS.minutesWord));

  return parts;
}

function respond(action: string, play: PlayItem[], opts?: { ok?: boolean; hangup?: boolean }): VoiceResponse {
  return { ok: opts?.ok ?? true, hangup: opts?.hangup ?? true, action, play };
}

// ---- One builder per case (mirrors the case table in the spec) ----------------------------

export const voice = {
  clockInSuccess: (hour: number, minute: number) =>
    respond("clock_in", [clip(RECORDINGS.clockInSuccess), ...timeSegments(hour, minute)]),

  // The single already_open clip already contains "ניתן לדווח יציאה בלבד" — no separate clip.
  alreadyOpen: (hour: number, minute: number) =>
    respond("already_in", [clip(RECORDINGS.alreadyOpen), ...timeSegments(hour, minute)]),

  clockOutSuccess: (hour: number, minute: number, workedMinutes: number) =>
    respond("clock_out", [
      clip(RECORDINGS.clockOutSuccess),
      ...timeSegments(hour, minute),
      clip(RECORDINGS.shiftDuration),
      ...durationSegments(workedMinutes),
    ]),

  noOpenShift: () => respond("no_open_shift", [clip(RECORDINGS.noOpenShift)]),

  // Past-shift (menu 3) submitted: confirm it's saved and read back the duration.
  pastShiftSaved: (workedMinutes: number) =>
    respond("past_shift_saved", [
      clip(RECORDINGS.pastShiftSaved),
      clip(RECORDINGS.shiftDuration),
      ...durationSegments(workedMinutes),
    ]),

  invalidDatetime: () => respond("invalid_datetime", [clip(RECORDINGS.invalidDatetime)], { ok: false }),

  notRecognized: () => respond("not_recognized", [clip(RECORDINGS.notRecognized)], { ok: false }),
  notAllowed: () => respond("not_allowed", [clip(RECORDINGS.notAllowed)], { ok: false }),
  invalidChoice: () => respond("invalid_choice", [clip(RECORDINGS.invalidChoice)], { ok: false }),
  systemError: () => respond("system_error", [clip(RECORDINGS.systemError)], { ok: false }),
};

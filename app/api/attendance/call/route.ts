import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { normalizePhone } from "@/lib/search/customerMatch";
import { callerMatchesStored } from "@/lib/attendance/phone-match";
import { normalizePayrollWorkerType, payrollWorkerTypeAllowsSessions } from "@/lib/payroll-worker-type";
import { voice, type VoiceResponse } from "@/lib/attendance/phone-voice";
import { buildPastShift } from "@/lib/attendance/phone-datetime";

/**
 * Phone clock-in / clock-out for workers with "kosher" phones (no app, no SMS).
 *
 * The telephony provider answers the call, plays a menu, and calls this endpoint SYNCHRONOUSLY
 * with the caller's number + the pressed digit (1 = כניסה, 2 = יציאה, 3 = last shift). We record
 * the shift in `phone_attendance_reports` — NOT in attendance_sessions — and return a `play` list
 * the provider speaks back (see lib/attendance/phone-voice.ts). An admin later approves and
 * classifies each report before it becomes a real session, so nothing here touches payroll.
 *
 * Parsing is deliberately liberal (GET/POST, JSON/form/query, field aliases): we define the
 * format, and a small mismatch on the provider's side must never leave a worker unable to report.
 */

const TABLE = "phone_attendance_reports";
const TOKEN_ENV = "ATTENDANCE_CALL_TOKEN";

// A worker double-dialling (common on feature phones) must not open-then-close a shift.
// Inside this window we just repeat the previous confirmation instead of toggling again.
const DEBOUNCE_MS = 45_000;

type Params = Record<string, string>;

type ReportRow = {
  id: string;
  clock_in: string;
  clock_out: string | null;
  worked_minutes: number | null;
  status: string;
};

/** Hour/minute/day/month in Israel — the server runs UTC, and the worker hears these spoken. */
function israelParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { hour: get("hour"), minute: get("minute"), day: get("day"), month: get("month") };
}

function minutesBetween(from: string, to: Date) {
  return Math.max(0, Math.round((to.getTime() - new Date(from).getTime()) / 60000));
}

/** Collect query string + body into one flat bag, so field placement never matters. */
async function readParams(req: Request): Promise<Params> {
  const params: Params = {};
  new URL(req.url).searchParams.forEach((value, key) => {
    params[key.toLowerCase()] = value;
  });

  if (req.method === "GET") return params;

  const contentType = req.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      const body = await req.json();
      if (body && typeof body === "object") {
        for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
          if (value != null && typeof value !== "object") params[key.toLowerCase()] = String(value);
        }
      }
    } else {
      const form = await req.formData();
      form.forEach((value, key) => {
        if (typeof value === "string") params[key.toLowerCase()] = value;
      });
    }
  } catch {
    // Malformed or empty body — the query string may still carry everything we need.
  }
  return params;
}

function pick(params: Params, aliases: string[]) {
  for (const alias of aliases) {
    const value = params[alias];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

/** Always HTTP 200 so the provider speaks the message instead of failing the call silently. */
function speak(result: VoiceResponse) {
  return NextResponse.json(result);
}

async function handle(req: Request) {
  const params = await readParams(req);

  const expectedToken = process.env[TOKEN_ENV];
  if (!expectedToken) {
    console.error(`[attendance/call] missing ${TOKEN_ENV}`);
    return speak(voice.systemError());
  }

  const providedToken =
    req.headers.get("x-attendance-token") ??
    req.headers.get("x-webhook-token") ??
    pick(params, ["token", "secret", "key"]);
  if (providedToken !== expectedToken) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const rawCaller = pick(params, ["caller", "caller_id", "callerid", "phone", "from", "src", "number"]);
  const digit = pick(params, ["digit", "dtmf", "key", "pressed", "choice", "input"]);
  const providerCallId = pick(params, ["call_id", "callid", "uniqueid", "unique_id", "id"]) || null;
  // Past-shift (menu 3): the four keypad fields, when the provider collected them.
  const pastShiftFields = {
    startDate: pick(params, ["start_date", "start_day_month", "sd"]),
    startTime: pick(params, ["start_time", "start_hour_minute", "st"]),
    endDate: pick(params, ["end_date", "end_day_month", "ed"]),
    endTime: pick(params, ["end_time", "end_hour_minute", "et"]),
  };
  const hasPastShiftFields = Boolean(
    pastShiftFields.startDate && pastShiftFields.startTime && pastShiftFields.endDate && pastShiftFields.endTime
  );
  const callerPhone = normalizePhone(rawCaller);

  if (!callerPhone) return speak(voice.notRecognized());

  const admin = createSupabaseAdminClient();
  if (!admin) {
    console.error("[attendance/call] admin client unavailable (missing service role key)");
    return speak(voice.systemError());
  }

  // Match in JS, not SQL: users.phone is free text (05x, +9725x, with separators) and the caller-ID
  // arrives without the 972 prefix, so callerMatchesStored folds both sides + compares the tail.
  const { data: userRows, error: usersError } = await admin
    .from("users")
    .select("id,full_name,phone,payroll_worker_type,pay_tracking_mode")
    .eq("active", true);

  if (usersError) {
    console.error("[attendance/call] user lookup failed", usersError.message);
    return speak(voice.systemError());
  }

  const worker = (userRows ?? []).find((row) => callerMatchesStored(rawCaller, row.phone));
  if (!worker) return speak(voice.notRecognized());

  const workerType = normalizePayrollWorkerType(worker.payroll_worker_type ?? null, worker.pay_tracking_mode ?? "session");
  if (!payrollWorkerTypeAllowsSessions(workerType)) return speak(voice.notAllowed());

  const { data: reportRows, error: reportsError } = await admin
    .from(TABLE)
    .select("id,clock_in,clock_out,worked_minutes,status")
    .eq("user_id", worker.id)
    .order("clock_in", { ascending: false })
    .limit(10);

  if (reportsError) {
    console.error("[attendance/call] report lookup failed", reportsError.message);
    return speak(voice.systemError());
  }

  const reports = (reportRows ?? []) as ReportRow[];
  const openReport = reports.find((row) => row.status === "open") ?? null;
  const lastClosed =
    reports
      .filter((row): row is ReportRow & { clock_out: string } => Boolean(row.clock_out))
      .sort((a, b) => new Date(b.clock_out).getTime() - new Date(a.clock_out).getTime())[0] ?? null;

  const now = new Date();

  // ---- Press 3: report a forgotten/past shift (worker keyed in start/end date+time) ----
  // The provider collects the four fields and posts them here in one call. The result goes straight
  // to pending_review — an admin classifies + approves it like any other phone report.
  if (hasPastShiftFields || digit === "3") {
    if (!hasPastShiftFields) return speak(voice.invalidChoice()); // pressed 3 but no data arrived

    const built = buildPastShift(pastShiftFields, now);
    if (!built.ok) return speak(voice.invalidDatetime());

    const { error: pastInsertError } = await admin.from(TABLE).insert({
      user_id: worker.id,
      clock_in: built.clockIn.toISOString(),
      clock_out: built.clockOut.toISOString(),
      worked_minutes: built.workedMinutes,
      status: "pending_review",
      source: "phone_past",
      provider_call_id: providerCallId,
      notes: "דיווח טלפוני — משמרת קודמת",
    });

    if (pastInsertError) {
      console.error("[attendance/call] past-shift insert failed", pastInsertError.message);
      return speak(voice.systemError());
    }

    return speak(voice.pastShiftSaved(built.workedMinutes));
  }

  // ---- Press 1: clock in ----
  if (digit === "1") {
    if (openReport) {
      const openedAt = new Date(openReport.clock_in);
      const t = israelParts(openedAt);
      // A repeat dial right after clocking in just confirms; otherwise remind they're already in.
      return speak(now.getTime() - openedAt.getTime() <= DEBOUNCE_MS ? voice.clockInSuccess(t.hour, t.minute) : voice.alreadyOpen(t.hour, t.minute));
    }

    const { error: insertError } = await admin.from(TABLE).insert({
      user_id: worker.id,
      clock_in: now.toISOString(),
      status: "open",
      source: "phone",
      provider_call_id: providerCallId,
      notes: "דיווח טלפוני",
    });

    if (insertError) {
      // Unique "one open per user" index → a shift opened between our read and write. Treat as
      // already-in rather than an error, so the worker hears a sensible message.
      console.error("[attendance/call] clock-in insert failed", insertError.message);
      const t = israelParts(now);
      return speak(voice.alreadyOpen(t.hour, t.minute));
    }

    const t = israelParts(now);
    return speak(voice.clockInSuccess(t.hour, t.minute));
  }

  // ---- Press 2: clock out ----
  if (digit === "2") {
    if (!openReport) {
      // A repeat dial right after clocking out just re-confirms the closed shift.
      if (lastClosed && now.getTime() - new Date(lastClosed.clock_out).getTime() <= DEBOUNCE_MS) {
        const t = israelParts(new Date(lastClosed.clock_out));
        const worked = lastClosed.worked_minutes ?? minutesBetween(lastClosed.clock_in, new Date(lastClosed.clock_out));
        return speak(voice.clockOutSuccess(t.hour, t.minute, worked));
      }
      return speak(voice.noOpenShift());
    }

    const worked = minutesBetween(openReport.clock_in, now);
    const { error: updateError } = await admin
      .from(TABLE)
      .update({ clock_out: now.toISOString(), worked_minutes: worked, status: "pending_review", updated_at: now.toISOString() })
      .eq("id", openReport.id)
      .eq("status", "open"); // guard against two calls closing the same shift concurrently

    if (updateError) {
      console.error("[attendance/call] clock-out update failed", updateError.message);
      return speak(voice.systemError());
    }

    const t = israelParts(now);
    return speak(voice.clockOutSuccess(t.hour, t.minute, worked));
  }

  // No digit or an unexpected one — the provider's menu should prevent this.
  return speak(voice.invalidChoice());
}

export async function POST(req: Request) {
  try {
    return await handle(req);
  } catch (error) {
    console.error("[attendance/call] unexpected failure", error);
    return speak(voice.systemError());
  }
}

// Some telephony platforms fire webhooks as GET — accept both so the provider can pick either.
export async function GET(req: Request) {
  return POST(req);
}

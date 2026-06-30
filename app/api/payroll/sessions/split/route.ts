import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { logAuditEvent } from "@/lib/audit";
import { isExpenseBusinessDomain } from "@/lib/expenses";
import { collectLockedSessionIds, recalculateUserSessionCostsFromRules } from "@/lib/payroll-center";
import {
  normalizePayrollWorkerType,
  payrollWorkerTypeAllowsSessions,
  payrollWorkerTypeGeneratesPayslips,
} from "@/lib/payroll-worker-type";
import { addMinutes, type PayrollPeriodRow, WORK_SESSIONS_TABLE } from "@/lib/payroll";

type SplitPartPayload = {
  // Time mode (hourly workers): how long this part lasted.
  minutes?: number | string | null;
  // Money mode (session/contract workers): the worker's cost for this part.
  amount?: number | string | null;
  business_domain?: string | null;
  project_id?: string | null;
  property_id?: string | null;
  // Per-part "bill the customer" toggle + amount.
  is_billable_to_customer?: boolean | null;
  bill_to_customer_amount?: number | string | null;
};

type SplitSessionPayload = {
  session_id?: string;
  parts?: SplitPartPayload[];
  // Optional: pay the (contractor) split shift in the SAME request. Done atomically — if the
  // payment fails, the split is rolled back so you never end up split-but-unpaid.
  payment?: { mark_paid?: boolean; amount?: number | string | null };
};

type NormalizedPart = {
  minutes: number;
  businessDomain: string;
  projectId: string | null;
  propertyId: string | null;
  // Explicit cost for money mode; null = recalculated from agreement rules (time mode).
  laborCost: number | null;
  isBillable: boolean;
  billAmount: number | null;
};

function toNumber(value: number | string | null | undefined) {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return NaN;
}

function toOptionalNonNegativeNumber(value: number | string | null | undefined) {
  if (value == null) return null;
  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function formatDateOnly(value: string) {
  return value.slice(0, 10);
}

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;

    const body = (await req.json().catch(() => ({}))) as SplitSessionPayload;
    const sessionId = typeof body.session_id === "string" ? body.session_id.trim() : "";
    const rawParts = Array.isArray(body.parts) ? body.parts : [];

    if (!sessionId) {
      return NextResponse.json({ error: "Missing session_id" }, { status: 400 });
    }
    if (rawParts.length < 2) {
      return NextResponse.json({ error: "יש להזין לפחות שני חלקים לפיצול." }, { status: 400 });
    }

    const { supabase, profile } = access.value;
    const [sessionResult, periodsResult] = await Promise.all([
      supabase
        .from(WORK_SESSIONS_TABLE)
        .select(
          "id,user_id,clock_in,clock_out,worked_minutes,notes,business_domain,project_id,property_id,labor_cost,is_billable_to_customer,bill_to_customer_amount,billing_status"
        )
        .eq("id", sessionId)
        .maybeSingle(),
      supabase.from("payroll_periods").select("id,period_month,start_date,end_date,status").range(0, 119),
    ]);

    if (sessionResult.error) return NextResponse.json({ error: toHebrewError(sessionResult.error.message) }, { status: 400 });
    if (periodsResult.error) return NextResponse.json({ error: toHebrewError(periodsResult.error.message) }, { status: 400 });
    if (!sessionResult.data || typeof sessionResult.data.clock_in !== "string" || typeof sessionResult.data.clock_out !== "string") {
      return NextResponse.json({ error: "Saved session not found" }, { status: 404 });
    }

    const lockedIds = collectLockedSessionIds(
      [{ id: sessionResult.data.id, clock_in: sessionResult.data.clock_in }],
      (periodsResult.data ?? []) as PayrollPeriodRow[]
    );
    if (lockedIds.has(sessionId)) {
      return NextResponse.json({ error: "This session belongs to a locked payroll period." }, { status: 409 });
    }

    const originalSession = sessionResult.data;

    // Mode is decided by the worker type, not the client: contract/session workers split by
    // money (explicit cost per part); hourly workers split by time (minutes per part).
    const workerResult = await supabase
      .from("users")
      .select("id,payroll_worker_type,pay_tracking_mode")
      .eq("id", originalSession.user_id)
      .maybeSingle();
    if (workerResult.error) {
      return NextResponse.json({ error: toHebrewError(workerResult.error.message) }, { status: 400 });
    }
    const workerType = normalizePayrollWorkerType(
      workerResult.data?.payroll_worker_type ?? null,
      workerResult.data?.pay_tracking_mode ?? "session"
    );
    if (!payrollWorkerTypeAllowsSessions(workerType)) {
      return NextResponse.json({ error: "This worker type does not use sessions." }, { status: 409 });
    }
    const splitMode: "money" | "time" = workerType === "session_only" ? "money" : "time";

    const originalStartMs = new Date(originalSession.clock_in).getTime();
    const originalEndMs = new Date(originalSession.clock_out).getTime();
    const totalMinutes = Math.round((originalEndMs - originalStartMs) / 60000);

    if (!Number.isFinite(totalMinutes) || totalMinutes <= 1) {
      return NextResponse.json({ error: "Session is too short to split" }, { status: 400 });
    }
    if (rawParts.length > totalMinutes) {
      return NextResponse.json({ error: "לא ניתן לפצל ליותר חלקים ממספר הדקות במשמרת." }, { status: 400 });
    }

    // For money mode the clock time is just bookkeeping — divide it evenly so the rows stay
    // contiguous and ordered; the meaningful value is each part's explicit cost.
    const evenBase = Math.floor(totalMinutes / rawParts.length);
    const evenMinutes = rawParts.map((_, index) =>
      index === rawParts.length - 1 ? totalMinutes - evenBase * (rawParts.length - 1) : evenBase
    );

    const normalizedParts: NormalizedPart[] = [];
    let consumedMinutes = 0;

    for (let index = 0; index < rawParts.length; index += 1) {
      const part = rawParts[index];
      const businessDomain = isExpenseBusinessDomain(part.business_domain) ? part.business_domain : null;
      const projectId = typeof part.project_id === "string" && part.project_id.trim() ? part.project_id.trim() : null;
      const propertyId = typeof part.property_id === "string" && part.property_id.trim() ? part.property_id.trim() : null;
      const isBillable = part.is_billable_to_customer === true;
      const billAmount = isBillable ? toOptionalNonNegativeNumber(part.bill_to_customer_amount) : null;

      if (!businessDomain) {
        return NextResponse.json({ error: `תחום לא תקין בחלק ${index + 1}.` }, { status: 400 });
      }
      if (businessDomain === "logistics_projects" && !projectId) {
        return NextResponse.json({ error: `יש לבחור פרויקט בחלק ${index + 1}.` }, { status: 400 });
      }
      if (businessDomain === "property_management" && !propertyId) {
        return NextResponse.json({ error: `יש לבחור נכס בחלק ${index + 1}.` }, { status: 400 });
      }
      if (isBillable && (billAmount === null || billAmount <= 0)) {
        return NextResponse.json({ error: `יש להזין סכום חיוב ללקוח תקין בחלק ${index + 1}.` }, { status: 400 });
      }

      let minutes: number;
      let laborCost: number | null;

      if (splitMode === "money") {
        const amount = toOptionalNonNegativeNumber(part.amount);
        if (amount === null) {
          return NextResponse.json({ error: `יש להזין סכום תקין בחלק ${index + 1}.` }, { status: 400 });
        }
        laborCost = amount;
        minutes = evenMinutes[index];
      } else {
        laborCost = null; // recalculated from agreement rules below
        minutes = Math.round(toNumber(part.minutes));
        if (index === rawParts.length - 1) {
          minutes = totalMinutes - consumedMinutes;
        }
        if (!Number.isFinite(minutes) || minutes <= 0) {
          return NextResponse.json({ error: `משך לא תקין בחלק ${index + 1}.` }, { status: 400 });
        }
        if (index < rawParts.length - 1) {
          const remainingParts = rawParts.length - index - 1;
          if (consumedMinutes + minutes > totalMinutes - remainingParts) {
            return NextResponse.json({ error: "סכום הדקות גדול ממשך המשמרת, ולא נשאר זמן לכל החלקים." }, { status: 400 });
          }
        }
      }

      consumedMinutes += minutes;
      normalizedParts.push({
        minutes,
        businessDomain,
        projectId: businessDomain === "logistics_projects" ? projectId : null,
        propertyId: businessDomain === "property_management" ? propertyId : null,
        laborCost,
        isBillable,
        billAmount: isBillable ? billAmount : null,
      });
    }

    if (consumedMinutes !== totalMinutes) {
      return NextResponse.json({ error: "סכום החלקים חייב להיות שווה לאורך המשמרת." }, { status: 400 });
    }

    for (const part of normalizedParts) {
      if (part.projectId) {
        const { data: project, error: projectError } = await supabase.from("projects").select("id").eq("id", part.projectId).maybeSingle();
        if (projectError) return NextResponse.json({ error: toHebrewError(projectError.message) }, { status: 400 });
        if (!project) return NextResponse.json({ error: "הפרויקט שנבחר לא נמצא." }, { status: 404 });
      }
      if (part.propertyId) {
        const { data: property, error: propertyError } = await supabase.from("properties").select("id").eq("id", part.propertyId).maybeSingle();
        if (propertyError) return NextResponse.json({ error: toHebrewError(propertyError.message) }, { status: 400 });
        if (!property) return NextResponse.json({ error: "הנכס שנבחר לא נמצא." }, { status: 404 });
      }
    }

    let cursor = originalSession.clock_in;
    const computedRanges = normalizedParts.map((part) => {
      const nextTime = addMinutes(cursor, part.minutes);
      if (!nextTime) throw new Error("Could not calculate split time");
      const range = {
        ...part,
        clockIn: cursor,
        clockOut: nextTime.toISOString(),
      };
      cursor = range.clockOut;
      return range;
    });

    const firstRange = computedRanges[0];
    const { error: updateError } = await supabase
      .from(WORK_SESSIONS_TABLE)
      .update({
        clock_out: firstRange.clockOut,
        worked_minutes: firstRange.minutes,
        business_domain: firstRange.businessDomain,
        project_id: firstRange.projectId,
        property_id: firstRange.propertyId,
        labor_cost: firstRange.laborCost,
        // Per-part customer billing applies in both modes (money split sets the worker's cost
        // too; time split leaves labor_cost null for the rule-based recalc).
        is_billable_to_customer: firstRange.isBillable,
        bill_to_customer_amount: firstRange.billAmount,
        billing_status: firstRange.isBillable ? "billable" : "not_billable",
      })
      .eq("id", sessionId);

    if (updateError) {
      return NextResponse.json({ error: toHebrewError(updateError.message) }, { status: 400 });
    }

    const insertRows = computedRanges.slice(1).map((part) => ({
      user_id: originalSession.user_id,
      clock_in: part.clockIn,
      clock_out: part.clockOut,
      worked_minutes: part.minutes,
      labor_cost: part.laborCost,
      is_billable_to_customer: part.isBillable,
      bill_to_customer_amount: part.billAmount,
      billing_status: part.isBillable ? "billable" : "not_billable",
      notes: originalSession.notes ?? null,
      business_domain: part.businessDomain,
      project_id: part.projectId,
      property_id: part.propertyId,
    }));

    let insertedIds: string[] = [];
    // Each resulting part with its cost — lets the caller allocate a payment across the parts.
    const resultSessions: Array<{ id: string; labor_cost: number | null }> = [
      { id: sessionId, labor_cost: firstRange.laborCost },
    ];
    if (insertRows.length > 0) {
      const { data: insertedRows, error: insertError } = await supabase
        .from(WORK_SESSIONS_TABLE)
        .insert(insertRows)
        .select("id,labor_cost");

      if (insertError) {
        await supabase
          .from(WORK_SESSIONS_TABLE)
          .update({
            clock_out: originalSession.clock_out,
            worked_minutes: originalSession.worked_minutes,
            business_domain: originalSession.business_domain,
            project_id: originalSession.project_id,
            property_id: originalSession.property_id,
            labor_cost: originalSession.labor_cost,
            is_billable_to_customer: originalSession.is_billable_to_customer,
            bill_to_customer_amount: originalSession.bill_to_customer_amount,
            billing_status: originalSession.billing_status,
          })
          .eq("id", sessionId);

        return NextResponse.json({ error: toHebrewError(insertError.message) }, { status: 400 });
      }

      const rows = (insertedRows ?? []) as Array<{ id?: string; labor_cost?: number | string | null }>;
      insertedIds = rows.map((row) => row.id ?? "").filter(Boolean);
      for (const row of rows) {
        if (row.id) {
          resultSessions.push({
            id: row.id,
            labor_cost: row.labor_cost == null ? null : Number(row.labor_cost),
          });
        }
      }
    }

    // Undo the split: delete the inserted parts and restore the original session to its pre-split
    // state. Used as compensation when the in-request payment fails, so the shift is never left
    // split-but-unpaid — the caller can safely retry against the still-intact session.
    const rollbackSplit = async () => {
      if (insertedIds.length > 0) {
        await supabase.from(WORK_SESSIONS_TABLE).delete().in("id", insertedIds);
      }
      await supabase
        .from(WORK_SESSIONS_TABLE)
        .update({
          clock_out: originalSession.clock_out,
          worked_minutes: originalSession.worked_minutes,
          business_domain: originalSession.business_domain,
          project_id: originalSession.project_id,
          property_id: originalSession.property_id,
          labor_cost: originalSession.labor_cost,
          is_billable_to_customer: originalSession.is_billable_to_customer,
          bill_to_customer_amount: originalSession.bill_to_customer_amount,
          billing_status: originalSession.billing_status,
        })
        .eq("id", sessionId);
    };

    // Atomic mark-paid for a contractor split: record one payment allocated across the parts
    // (waterfall: fill part 1, then part 2, …). Allocations go straight onto the freshly-created
    // parts (owed = labor_cost), so this needs no debt-view lookup and can't half-apply.
    let paidPaymentId: string | null = null;
    if (splitMode === "money" && body.payment?.mark_paid === true) {
      const partsTotal = resultSessions.reduce((sum, part) => sum + (part.labor_cost ?? 0), 0);
      const requestedRaw = toOptionalNonNegativeNumber(body.payment.amount ?? null);
      const requested = requestedRaw && requestedRaw > 0 ? Math.min(requestedRaw, partsTotal) : partsTotal;

      let remaining = requested;
      const allocationRows: Array<{ source_id: string; amount: number }> = [];
      for (const part of resultSessions) {
        if (remaining <= 0.009) break;
        const owed = part.labor_cost ?? 0;
        const allocated = Math.min(remaining, owed);
        if (allocated > 0.009) {
          allocationRows.push({ source_id: part.id, amount: allocated });
          remaining -= allocated;
        }
      }

      const total = allocationRows.reduce((sum, allocation) => sum + allocation.amount, 0);
      if (total > 0.009) {
        const paymentDateSource = originalSession.clock_out || originalSession.clock_in;
        const paymentInsert = await supabase
          .from("worker_payments")
          .insert({
            user_id: originalSession.user_id,
            payment_date: formatDateOnly(paymentDateSource),
            amount: total,
            payment_method: null,
            reference_number: null,
            notes: "תשלום שסומן מתוך פיצול משמרת",
            account_id: null,
            recorded_by: profile.id,
          })
          .select("id")
          .maybeSingle();

        if (paymentInsert.error || !paymentInsert.data?.id) {
          await rollbackSplit();
          return NextResponse.json(
            { error: toHebrewError(paymentInsert.error?.message ?? "רישום התשלום נכשל.") },
            { status: 400 }
          );
        }
        paidPaymentId = paymentInsert.data.id;

        const allocationInsert = await supabase.from("worker_payment_allocations").insert(
          allocationRows.map((allocation) => ({
            worker_payment_id: paidPaymentId,
            source_type: "session",
            attendance_session_id: allocation.source_id,
            payslip_id: null,
            amount: allocation.amount,
          }))
        );

        if (allocationInsert.error) {
          await supabase.from("worker_payment_allocations").delete().eq("worker_payment_id", paidPaymentId);
          await supabase.from("worker_payments").delete().eq("id", paidPaymentId);
          await rollbackSplit();
          return NextResponse.json({ error: toHebrewError(allocationInsert.error.message) }, { status: 400 });
        }
      }
    }

    // Money mode sets each part's labor_cost explicitly; only time mode recalculates from rules.
    if (splitMode === "time") {
      await recalculateUserSessionCostsFromRules(supabase, originalSession.user_id, {
        fromDate: formatDateOnly(originalSession.clock_in),
        regeneratePayslips: payrollWorkerTypeGeneratesPayslips(workerType),
      });
    }

    await logAuditEvent({
      supabase,
      tableName: WORK_SESSIONS_TABLE,
      recordId: sessionId,
      action: "update",
      changedBy: profile.id,
      userRole: profile.role,
    });

    for (const insertedId of insertedIds) {
      await logAuditEvent({
        supabase,
        tableName: WORK_SESSIONS_TABLE,
        recordId: insertedId,
        action: "create",
        changedBy: profile.id,
        userRole: profile.role,
      });
    }

    if (paidPaymentId) {
      await logAuditEvent({
        supabase,
        tableName: "worker_payments",
        recordId: paidPaymentId,
        action: "create",
        changedBy: profile.id,
        userRole: profile.role,
      });
    }

    return NextResponse.json({ ok: true, sessions: resultSessions, payment_id: paidPaymentId });
  } catch (error: unknown) {
    const message = toHebrewError(error, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

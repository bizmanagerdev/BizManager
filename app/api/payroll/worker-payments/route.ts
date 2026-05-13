import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { logAuditEvent } from "@/lib/audit";
import {
  normalizePayrollWorkerType,
  payrollWorkerTypePaymentAllocationSource,
} from "@/lib/payroll-worker-type";

type WorkerPaymentAllocationInput = {
  source_type?: "session" | "payslip";
  source_id?: string;
  amount?: number | string;
};

type WorkerPaymentPayload = {
  payment_id?: string;
  user_id?: string;
  payment_date?: string;
  amount?: number | string;
  payment_method?: string | null;
  reference_number?: string | null;
  notes?: string | null;
  allocations?: WorkerPaymentAllocationInput[];
};

type DebtItemRow = {
  source_type: "session" | "payslip";
  source_id: string;
  user_id: string;
  owed_amount: number | string | null;
};

type ExistingAllocationRow = {
  id: string;
  source_type: "session" | "payslip";
  attendance_session_id: string | null;
  payslip_id: string | null;
  amount: number | string | null;
};

function toAmount(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  return NaN;
}

async function saveWorkerPayment(req: Request, mode: "create" | "update") {
  const access = await requireRouteAccess({ allowedRoles: ["admin"] });
  if (!access.ok) return access.response;

  const body = (await req.json().catch(() => ({}))) as WorkerPaymentPayload;
  const { supabase, profile } = access.value;

  const paymentId = typeof body.payment_id === "string" ? body.payment_id.trim() : "";
  const userId = typeof body.user_id === "string" ? body.user_id.trim() : "";
  const paymentDate = typeof body.payment_date === "string" ? body.payment_date.trim() : "";
  const paymentMethod = typeof body.payment_method === "string" ? body.payment_method.trim() || null : null;
  const referenceNumber =
    typeof body.reference_number === "string" ? body.reference_number.trim() || null : null;
  const notes = typeof body.notes === "string" ? body.notes.trim() || null : null;
  const amount = toAmount(body.amount);
  const allocations = Array.isArray(body.allocations) ? body.allocations : [];

  if (mode === "update" && !paymentId) {
    return NextResponse.json({ error: "payment_id is required." }, { status: 400 });
  }
  if (!userId) {
    return NextResponse.json({ error: "user_id is required." }, { status: 400 });
  }
  if (!paymentDate) {
    return NextResponse.json({ error: "payment_date is required." }, { status: 400 });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Valid amount is required." }, { status: 400 });
  }
  if (allocations.length === 0) {
    return NextResponse.json({ error: "At least one allocation is required." }, { status: 400 });
  }

  const workerResult = await supabase
    .from("users")
    .select("id,payroll_worker_type,pay_tracking_mode")
    .eq("id", userId)
    .maybeSingle();
  if (workerResult.error) {
    return NextResponse.json({ error: workerResult.error.message }, { status: 400 });
  }
  if (!workerResult.data?.id) {
    return NextResponse.json({ error: "Worker not found." }, { status: 404 });
  }

  const workerType = normalizePayrollWorkerType(
    workerResult.data.payroll_worker_type,
    workerResult.data.pay_tracking_mode
  );
  const expectedSourceType = payrollWorkerTypePaymentAllocationSource(workerType);

  const normalizedAllocations = allocations
    .map((allocation) => {
      const sourceType = allocation.source_type === "payslip" ? "payslip" : "session";
      const sourceId = typeof allocation.source_id === "string" ? allocation.source_id.trim() : "";
      const allocationAmount = toAmount(allocation.amount);
      return {
        source_type: sourceType,
        source_id: sourceId,
        amount: allocationAmount,
      };
    })
    .filter((allocation) => allocation.source_id && Number.isFinite(allocation.amount) && allocation.amount > 0);

  if (normalizedAllocations.length === 0) {
    return NextResponse.json({ error: "No valid allocations were provided." }, { status: 400 });
  }
  if (normalizedAllocations.some((allocation) => allocation.source_type !== expectedSourceType)) {
    return NextResponse.json(
      { error: `Worker payments for this worker must be allocated by ${expectedSourceType}.` },
      { status: 400 }
    );
  }

  const allocationTotal = normalizedAllocations.reduce((sum, allocation) => sum + allocation.amount, 0);
  if (Math.abs(allocationTotal - amount) > 0.01) {
    return NextResponse.json({ error: "Allocation total must match payment amount exactly." }, { status: 400 });
  }

  let existingPaymentId = paymentId;
  let existingAllocations: ExistingAllocationRow[] = [];

  if (mode === "update") {
    const existingPaymentResult = await supabase
      .from("worker_payments")
      .select("id,user_id")
      .eq("id", paymentId)
      .maybeSingle();

    if (existingPaymentResult.error) {
      return NextResponse.json({ error: existingPaymentResult.error.message }, { status: 400 });
    }
    if (!existingPaymentResult.data?.id) {
      return NextResponse.json({ error: "Payment not found." }, { status: 404 });
    }
    if (existingPaymentResult.data.user_id !== userId) {
      return NextResponse.json({ error: "Payment does not belong to this worker." }, { status: 400 });
    }

    const existingAllocationsResult = await supabase
      .from("worker_payment_allocations")
      .select("id,source_type,attendance_session_id,payslip_id,amount")
      .eq("worker_payment_id", paymentId);

    if (existingAllocationsResult.error) {
      return NextResponse.json({ error: existingAllocationsResult.error.message }, { status: 400 });
    }

    existingAllocations = (existingAllocationsResult.data ?? []) as ExistingAllocationRow[];
  }

  const mergedBySourceId = new Map<string, number>();
  normalizedAllocations.forEach((allocation) => {
    mergedBySourceId.set(allocation.source_id, (mergedBySourceId.get(allocation.source_id) ?? 0) + allocation.amount);
  });

  const existingAllocationBySourceId = new Map<string, number>();
  existingAllocations.forEach((allocation) => {
    const sourceId = allocation.source_type === "session" ? allocation.attendance_session_id : allocation.payslip_id;
    if (!sourceId) return;
    existingAllocationBySourceId.set(sourceId, (existingAllocationBySourceId.get(sourceId) ?? 0) + (toAmount(allocation.amount) || 0));
  });

  const sourceIdsToValidate = Array.from(new Set([...mergedBySourceId.keys(), ...existingAllocationBySourceId.keys()]));
  const debtItemsResult = await supabase
    .from("worker_debt_items_view")
    .select("source_type,source_id,user_id,owed_amount")
    .eq("user_id", userId)
    .eq("source_type", expectedSourceType)
    .in("source_id", sourceIdsToValidate);

  if (debtItemsResult.error) {
    return NextResponse.json({ error: debtItemsResult.error.message }, { status: 400 });
  }

  const debtItems = (debtItemsResult.data ?? []) as DebtItemRow[];
  if (debtItems.length !== sourceIdsToValidate.length) {
    return NextResponse.json({ error: "One or more allocations do not belong to this worker." }, { status: 400 });
  }

  for (const item of debtItems) {
    const requestedAmount = mergedBySourceId.get(item.source_id) ?? 0;
    const currentOwedAmount = toAmount(item.owed_amount);
    const existingAmountOnThisPayment = existingAllocationBySourceId.get(item.source_id) ?? 0;
    const availableAmount = currentOwedAmount + existingAmountOnThisPayment;
    if (!Number.isFinite(currentOwedAmount) || requestedAmount - availableAmount > 0.01) {
      return NextResponse.json(
        { error: "Cannot allocate more than the remaining debt on an item." },
        { status: 400 }
      );
    }
  }

  if (mode === "create") {
    const paymentInsert = await supabase
      .from("worker_payments")
      .insert({
        user_id: userId,
        payment_date: paymentDate,
        amount,
        payment_method: paymentMethod,
        reference_number: referenceNumber,
        notes,
        recorded_by: profile.id,
      })
      .select("id,user_id,payment_date,amount,payment_method,reference_number,notes,recorded_by,created_at")
      .maybeSingle();

    if (paymentInsert.error) {
      return NextResponse.json({ error: paymentInsert.error.message }, { status: 400 });
    }
    if (!paymentInsert.data?.id) {
      return NextResponse.json({ error: "Failed to create payment." }, { status: 500 });
    }

    existingPaymentId = paymentInsert.data.id;
  } else {
    const paymentUpdate = await supabase
      .from("worker_payments")
      .update({
        payment_date: paymentDate,
        amount,
        payment_method: paymentMethod,
        reference_number: referenceNumber,
        notes,
      })
      .eq("id", existingPaymentId)
      .select("id,user_id,payment_date,amount,payment_method,reference_number,notes,recorded_by,created_at")
      .maybeSingle();

    if (paymentUpdate.error) {
      return NextResponse.json({ error: paymentUpdate.error.message }, { status: 400 });
    }
    if (!paymentUpdate.data?.id) {
      return NextResponse.json({ error: "Failed to update payment." }, { status: 500 });
    }

    const deleteExistingAllocations = await supabase
      .from("worker_payment_allocations")
      .delete()
      .eq("worker_payment_id", existingPaymentId);

    if (deleteExistingAllocations.error) {
      return NextResponse.json({ error: deleteExistingAllocations.error.message }, { status: 400 });
    }

  }

  const allocationRows = normalizedAllocations.map((allocation) => ({
    worker_payment_id: existingPaymentId,
    source_type: allocation.source_type,
    attendance_session_id: allocation.source_type === "session" ? allocation.source_id : null,
    payslip_id: allocation.source_type === "payslip" ? allocation.source_id : null,
    amount: allocation.amount,
  }));

  const allocationInsert = await supabase
    .from("worker_payment_allocations")
    .insert(allocationRows)
    .select("id,worker_payment_id,source_type,attendance_session_id,payslip_id,amount,created_at");

  if (allocationInsert.error) {
    if (mode === "create") {
      await supabase.from("worker_payments").delete().eq("id", existingPaymentId);
    }
    return NextResponse.json({ error: allocationInsert.error.message }, { status: 400 });
  }

  const paymentResult = await supabase
    .from("worker_payments")
    .select("id,user_id,payment_date,amount,payment_method,reference_number,notes,recorded_by,created_at")
    .eq("id", existingPaymentId)
    .maybeSingle();

  if (paymentResult.error) {
    return NextResponse.json({ error: paymentResult.error.message }, { status: 400 });
  }

  await logAuditEvent({
    supabase,
    tableName: "worker_payments",
    recordId: existingPaymentId,
    action: mode === "create" ? "create" : "update",
    changedBy: profile.id,
    userRole: profile.role,
  });

  return NextResponse.json({
    payment: paymentResult.data,
    allocations: allocationInsert.data ?? [],
  });
}

export async function POST(req: Request) {
  try {
    return await saveWorkerPayment(req, "create");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    return await saveWorkerPayment(req, "update");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin"] });
    if (!access.ok) return access.response;

    const body = (await req.json().catch(() => ({}))) as Pick<WorkerPaymentPayload, "payment_id" | "user_id">;
    const paymentId = typeof body.payment_id === "string" ? body.payment_id.trim() : "";
    const userId = typeof body.user_id === "string" ? body.user_id.trim() : "";
    const { supabase, profile } = access.value;

    if (!paymentId) {
      return NextResponse.json({ error: "payment_id is required." }, { status: 400 });
    }

    const existingPaymentResult = await supabase
      .from("worker_payments")
      .select("id,user_id")
      .eq("id", paymentId)
      .maybeSingle();

    if (existingPaymentResult.error) {
      return NextResponse.json({ error: existingPaymentResult.error.message }, { status: 400 });
    }
    if (!existingPaymentResult.data?.id) {
      return NextResponse.json({ error: "Payment not found." }, { status: 404 });
    }
    if (userId && existingPaymentResult.data.user_id !== userId) {
      return NextResponse.json({ error: "Payment does not belong to this worker." }, { status: 400 });
    }

    const deleteResult = await supabase.from("worker_payments").delete().eq("id", paymentId);
    if (deleteResult.error) {
      return NextResponse.json({ error: deleteResult.error.message }, { status: 400 });
    }

    await logAuditEvent({
      supabase,
      tableName: "worker_payments",
      recordId: paymentId,
      action: "delete",
      changedBy: profile.id,
      userRole: profile.role,
    });

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { isPayrollPeriodEditable } from "@/lib/payroll-center";

type PayslipItemPayload = {
  payslip_id?: string;
  item_type?: string | null;
  amount?: number | string | null;
  notes?: string | null;
};

type DeletePayslipItemPayload = {
  item_id?: string;
  payslip_id?: string;
};

function toNullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(parsed) ? parsed : null;
}

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin"] });
    if (!access.ok) return access.response;

    const body = (await req.json().catch(() => ({}))) as PayslipItemPayload;
    const payslipId = typeof body.payslip_id === "string" ? body.payslip_id.trim() : "";
    const itemType = typeof body.item_type === "string" ? body.item_type.trim() : "manual";
    const amount = toNullableNumber(body.amount);
    const notes = typeof body.notes === "string" ? body.notes.trim() : null;

    if (!payslipId || amount === null) {
      return NextResponse.json({ error: "payslip_id and amount are required." }, { status: 400 });
    }

    const { supabase } = access.value;
    const payslipResult = await supabase
      .from("payslips")
      .select("id,payroll_period_id")
      .eq("id", payslipId)
      .maybeSingle();

    if (payslipResult.error) {
      return NextResponse.json({ error: toHebrewError(payslipResult.error.message) }, { status: 400 });
    }
    if (!payslipResult.data) {
      return NextResponse.json({ error: "Payslip not found." }, { status: 404 });
    }

    const periodResult = await supabase
      .from("payroll_periods")
      .select("id,status")
      .eq("id", payslipResult.data.payroll_period_id)
      .maybeSingle();

    if (periodResult.error) {
      return NextResponse.json({ error: toHebrewError(periodResult.error.message) }, { status: 400 });
    }
    if (!periodResult.data || !isPayrollPeriodEditable(periodResult.data.status)) {
      return NextResponse.json({ error: "Only open payroll periods can be edited." }, { status: 409 });
    }

    const insertResult = await supabase
      .from("payslip_items")
      .insert({
        payslip_id: payslipId,
        item_type: itemType || "manual",
        amount,
        notes,
      })
      .select("id,payslip_id,item_type,amount,notes")
      .maybeSingle();

    if (insertResult.error) {
      return NextResponse.json({ error: toHebrewError(insertResult.error.message) }, { status: 400 });
    }

    const itemsResult = await supabase
      .from("payslip_items")
      .select("amount")
      .eq("payslip_id", payslipId)
      .range(0, 999);

    if (itemsResult.error) {
      return NextResponse.json({ error: toHebrewError(itemsResult.error.message) }, { status: 400 });
    }

    const totalItems = ((itemsResult.data ?? []) as Array<{ amount: number | string | null }>).reduce(
      (sum, item) => sum + (toNullableNumber(item.amount) ?? 0),
      0
    );

    const fullPayslipResult = await supabase
      .from("payslips")
      .select("id,calculated_base_salary,manual_adjustments")
      .eq("id", payslipId)
      .maybeSingle();

    if (fullPayslipResult.error || !fullPayslipResult.data) {
      return NextResponse.json({ error: fullPayslipResult.error?.message ?? "Payslip not found." }, { status: 400 });
    }

    const grossSalary =
      (toNullableNumber(fullPayslipResult.data.calculated_base_salary) ?? 0) +
      (toNullableNumber(fullPayslipResult.data.manual_adjustments) ?? 0) +
      totalItems;

    const updatePayslip = await supabase
      .from("payslips")
      .update({ gross_salary: grossSalary })
      .eq("id", payslipId);

    if (updatePayslip.error) {
      return NextResponse.json({ error: toHebrewError(updatePayslip.error.message) }, { status: 400 });
    }

    return NextResponse.json({ item: insertResult.data });
  } catch (error: unknown) {
    const message = toHebrewError(error, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin"] });
    if (!access.ok) return access.response;

    const body = (await req.json().catch(() => ({}))) as DeletePayslipItemPayload;
    const itemId = typeof body.item_id === "string" ? body.item_id.trim() : "";
    const payslipId = typeof body.payslip_id === "string" ? body.payslip_id.trim() : "";

    if (!itemId || !payslipId) {
      return NextResponse.json({ error: "item_id and payslip_id are required." }, { status: 400 });
    }

    const { supabase } = access.value;

    const payslipResult = await supabase
      .from("payslips")
      .select("id,payroll_period_id,calculated_base_salary,manual_adjustments")
      .eq("id", payslipId)
      .maybeSingle();

    if (payslipResult.error || !payslipResult.data) {
      return NextResponse.json({ error: "Payslip not found." }, { status: 404 });
    }

    const periodResult = await supabase
      .from("payroll_periods")
      .select("id,status")
      .eq("id", payslipResult.data.payroll_period_id)
      .maybeSingle();

    if (!periodResult.data || !isPayrollPeriodEditable(periodResult.data.status)) {
      return NextResponse.json({ error: "Only open payroll periods can be edited." }, { status: 409 });
    }

    const deleteResult = await supabase.from("payslip_items").delete().eq("id", itemId).eq("payslip_id", payslipId);
    if (deleteResult.error) {
      return NextResponse.json({ error: toHebrewError(deleteResult.error.message) }, { status: 400 });
    }

    const itemsResult = await supabase.from("payslip_items").select("amount").eq("payslip_id", payslipId).range(0, 999);
    const totalItems = ((itemsResult.data ?? []) as Array<{ amount: number | string | null }>).reduce(
      (sum, item) => sum + (toNullableNumber(item.amount) ?? 0),
      0
    );
    const grossSalary =
      (toNullableNumber(payslipResult.data.calculated_base_salary) ?? 0) +
      (toNullableNumber(payslipResult.data.manual_adjustments) ?? 0) +
      totalItems;

    await supabase.from("payslips").update({ gross_salary: grossSalary }).eq("id", payslipId);

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const message = toHebrewError(error, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

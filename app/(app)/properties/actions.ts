"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth/requireProfile";
import { toHebrewError } from "@/lib/error-messages";
import { buildPaymentInsert } from "@/lib/payments";
import type { PropertyInput } from "./PropertyFormFields";

export type ActionResult = { ok: true; id?: string } | { ok: false; error: string };

export type LeaseInput = {
  customer_id: string;
  start_date: string;
  end_date: string; // "" → null
  monthly_rent_amount: string; // raw, parsed here
  status: string; // 'active' | 'ended' | 'cancelled'
  notes: string;
  deposit_type: string; // '' | 'cash' | 'bank_guarantee' | 'security_check'
  deposit_amount: string;
  deposit_reference: string;
};

function clean(value: string | null | undefined) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? trimmed : null;
}

function numOrNull(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

async function getStaffContext() {
  const { profile, supabase } = await requireProfile();
  if (profile.role !== "admin" && profile.role !== "office") {
    return { ok: false as const, error: "אין הרשאה לבצע פעולה זו." };
  }
  return { ok: true as const, profile, supabase };
}

function revalidateProperties(id?: string) {
  revalidatePath("/properties");
  if (id) revalidatePath(`/properties/${id}`);
}

function propertyFields(input: PropertyInput) {
  return {
    name: clean(input.name),
    address: clean(input.address) ?? "",
    asset_description: clean(input.asset_description),
    is_active: input.is_active,
    property_type: clean(input.property_type),
    apartments_count: numOrNull(input.apartments_count),
    rooms: numOrNull(input.rooms),
    square_meters: numOrNull(input.square_meters),
    floor: numOrNull(input.floor),
    bathrooms: numOrNull(input.bathrooms),
    has_private_entrance: input.has_private_entrance,
    has_storage_room: input.has_storage_room,
    has_parking: input.has_parking,
    has_elevator: input.has_elevator,
    purchased_from: clean(input.purchased_from),
    purchase_date: clean(input.purchase_date),
    purchase_price: numOrNull(input.purchase_price),
    purchase_tax: numOrNull(input.purchase_tax),
    land_block: clean(input.land_block),
    land_parcel: clean(input.land_parcel),
    land_sub_parcel: clean(input.land_sub_parcel),
    is_furnished: input.is_furnished,
    furniture_items: input.furniture_items,
  };
}

export async function createProperty(input: PropertyInput): Promise<ActionResult> {
  try {
    const ctx = await getStaffContext();
    if (!ctx.ok) return { ok: false, error: ctx.error };
    if (!clean(input.address)) return { ok: false, error: "יש להזין כתובת." };
    if (!clean(input.name)) return { ok: false, error: "יש להזין שם לנכס." };

    const { data, error } = await ctx.supabase
      .from("properties")
      .insert(propertyFields(input))
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: toHebrewError(error, "שגיאה ביצירת הנכס.") };

    const id = (data as { id: string }).id;
    revalidateProperties(id);
    return { ok: true, id };
  } catch (error) {
    return { ok: false, error: toHebrewError(error, "שגיאה ביצירת הנכס.") };
  }
}

export async function updateProperty(id: string, input: PropertyInput): Promise<ActionResult> {
  try {
    const ctx = await getStaffContext();
    if (!ctx.ok) return { ok: false, error: ctx.error };
    if (!id) return { ok: false, error: "חסר מזהה נכס." };
    if (!clean(input.address)) return { ok: false, error: "יש להזין כתובת." };
    if (!clean(input.name)) return { ok: false, error: "יש להזין שם לנכס." };

    const { error } = await ctx.supabase
      .from("properties")
      .update({ ...propertyFields(input), updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return { ok: false, error: toHebrewError(error, "שגיאה בעדכון הנכס.") };

    revalidateProperties(id);
    return { ok: true, id };
  } catch (error) {
    return { ok: false, error: toHebrewError(error, "שגיאה בעדכון הנכס.") };
  }
}

/**
 * Guarded hard delete: lease_agreements.property_id is ON DELETE RESTRICT, and
 * SET-NULLing property_id on a property_management expense/payment/task/
 * recurring template/attendance session would violate its own "domain requires
 * property_id" check constraint. Rather than surface a raw Postgres error,
 * block up front and point at the is_active toggle (archiving) as the safe
 * alternative.
 */
export async function deleteProperty(id: string): Promise<ActionResult> {
  try {
    const ctx = await getStaffContext();
    if (!ctx.ok) return { ok: false, error: ctx.error };
    if (!id) return { ok: false, error: "חסר מזהה נכס." };

    const [
      { count: leases },
      { count: expenses },
      { count: payments },
      { count: tasks },
      { count: recurringExpenseTemplates },
      { count: recurringTaskTemplates },
      { count: attendanceSessions },
    ] = await Promise.all([
      ctx.supabase.from("lease_agreements").select("id", { count: "exact", head: true }).eq("property_id", id),
      ctx.supabase.from("expenses").select("id", { count: "exact", head: true }).eq("property_id", id),
      ctx.supabase.from("payments").select("id", { count: "exact", head: true }).eq("property_id", id),
      ctx.supabase.from("tasks").select("id", { count: "exact", head: true }).eq("property_id", id),
      ctx.supabase.from("recurring_expense_templates").select("id", { count: "exact", head: true }).eq("property_id", id),
      ctx.supabase.from("recurring_task_templates").select("id", { count: "exact", head: true }).eq("property_id", id),
      ctx.supabase.from("attendance_sessions").select("id", { count: "exact", head: true }).eq("property_id", id),
    ]);
    if (
      (leases ?? 0) +
        (expenses ?? 0) +
        (payments ?? 0) +
        (tasks ?? 0) +
        (recurringExpenseTemplates ?? 0) +
        (recurringTaskTemplates ?? 0) +
        (attendanceSessions ?? 0) >
      0
    ) {
      return {
        ok: false,
        error:
          "לא ניתן למחוק נכס עם היסטוריה (חוזים, הוצאות, הכנסות, משימות, הוצאות קבועות או דיווחי נוכחות). ניתן להשבית אותו במקום, דרך עריכת הנכס.",
      };
    }

    const { error } = await ctx.supabase.from("properties").delete().eq("id", id);
    if (error) return { ok: false, error: toHebrewError(error, "שגיאה במחיקת הנכס.") };

    revalidateProperties();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toHebrewError(error, "שגיאה במחיקת הנכס.") };
  }
}

function leaseFields(input: LeaseInput) {
  return {
    customer_id: input.customer_id,
    start_date: input.start_date,
    end_date: clean(input.end_date),
    monthly_rent_amount: Number(input.monthly_rent_amount) || 0,
    status: input.status || "active",
    notes: clean(input.notes),
    deposit_type: clean(input.deposit_type),
    deposit_amount: numOrNull(input.deposit_amount),
    deposit_reference: clean(input.deposit_reference),
  };
}

export async function createLease(propertyId: string, input: LeaseInput): Promise<ActionResult> {
  try {
    const ctx = await getStaffContext();
    if (!ctx.ok) return { ok: false, error: ctx.error };
    if (!propertyId) return { ok: false, error: "חסר מזהה נכס." };
    if (!input.customer_id) return { ok: false, error: "יש לבחור לקוח." };
    if (!input.start_date) return { ok: false, error: "יש להזין תאריך התחלת שכירות." };
    if (!(Number(input.monthly_rent_amount) > 0)) return { ok: false, error: "יש להזין מחיר חודשי תקין." };

    const { data, error } = await ctx.supabase
      .from("lease_agreements")
      .insert({ property_id: propertyId, ...leaseFields(input) })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: toHebrewError(error, "שגיאה ביצירת החוזה.") };

    revalidateProperties(propertyId);
    return { ok: true, id: (data as { id: string }).id };
  } catch (error) {
    return { ok: false, error: toHebrewError(error, "שגיאה ביצירת החוזה.") };
  }
}

export async function updateLease(
  propertyId: string,
  leaseId: string,
  input: LeaseInput
): Promise<ActionResult> {
  try {
    const ctx = await getStaffContext();
    if (!ctx.ok) return { ok: false, error: ctx.error };
    if (!leaseId) return { ok: false, error: "חסר מזהה חוזה." };
    if (!input.customer_id) return { ok: false, error: "יש לבחור לקוח." };
    if (!input.start_date) return { ok: false, error: "יש להזין תאריך התחלת שכירות." };
    if (!(Number(input.monthly_rent_amount) > 0)) return { ok: false, error: "יש להזין מחיר חודשי תקין." };

    const { error } = await ctx.supabase
      .from("lease_agreements")
      .update({ ...leaseFields(input), updated_at: new Date().toISOString() })
      .eq("id", leaseId);
    if (error) return { ok: false, error: toHebrewError(error, "שגיאה בעדכון החוזה.") };

    revalidateProperties(propertyId);
    return { ok: true, id: leaseId };
  } catch (error) {
    return { ok: false, error: toHebrewError(error, "שגיאה בעדכון החוזה.") };
  }
}

export async function deleteLease(propertyId: string, leaseId: string): Promise<ActionResult> {
  try {
    const ctx = await getStaffContext();
    if (!ctx.ok) return { ok: false, error: ctx.error };
    if (!leaseId) return { ok: false, error: "חסר מזהה חוזה." };

    const { error } = await ctx.supabase.from("lease_agreements").delete().eq("id", leaseId);
    if (error) return { ok: false, error: toHebrewError(error, "שגיאה במחיקת החוזה.") };

    revalidateProperties(propertyId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toHebrewError(error, "שגיאה במחיקת החוזה.") };
  }
}

/** Attach (or detach, documentId=null) an uploaded document as the lease's signed agreement. */
export async function setLeaseDocument(
  propertyId: string,
  leaseId: string,
  documentId: string | null
): Promise<ActionResult> {
  try {
    const ctx = await getStaffContext();
    if (!ctx.ok) return { ok: false, error: ctx.error };
    if (!leaseId) return { ok: false, error: "חסר מזהה חוזה." };

    const { error } = await ctx.supabase
      .from("lease_agreements")
      .update({ document_id: documentId, updated_at: new Date().toISOString() })
      .eq("id", leaseId);
    if (error) return { ok: false, error: toHebrewError(error, "שגיאה בשיוך המסמך.") };

    revalidateProperties(propertyId);
    return { ok: true, id: leaseId };
  } catch (error) {
    return { ok: false, error: toHebrewError(error, "שגיאה בשיוך המסמך.") };
  }
}

export type RentScheduleRowInput = {
  paymentDate: string;
  dueDate: string;
  amount: number;
  checkNumber: string;
};

export type ScheduleRentResult =
  | { ok: true; inserted: number; skipped: number }
  | { ok: false; error: string };

/**
 * Pre-schedule a batch of rent payments for a property (one per rental month),
 * each a pending 'check' payment: payment_date = the rental month it covers,
 * due_date = when the actual post-dated check clears. Purely additive — never
 * deletes/replaces existing rows, so re-running to extend the schedule is safe
 * — but rows whose rental month already has a scheduled payment for this
 * property are skipped rather than double-booked (a double-submit or an
 * overlapping "extend the schedule" run should not create duplicate checks).
 */
export async function scheduleRentPayments(
  propertyId: string,
  rows: RentScheduleRowInput[],
  accountId: string
): Promise<ScheduleRentResult> {
  try {
    const ctx = await getStaffContext();
    if (!ctx.ok) return { ok: false, error: ctx.error };
    if (!propertyId) return { ok: false, error: "חסר מזהה נכס." };
    if (rows.length === 0) return { ok: false, error: "לא הוזנו תשלומים." };
    if (!accountId) return { ok: false, error: "יש לבחור חשבון." };
    const invalid = rows.find((row) => !row.paymentDate || !row.dueDate || !(row.amount > 0));
    if (invalid) return { ok: false, error: "כל תשלום חייב תאריך לחודש, תאריך פרעון וסכום תקין." };

    const { data: existingRows, error: existingError } = await ctx.supabase
      .from("payments")
      .select("payment_date")
      .eq("property_id", propertyId)
      .eq("business_domain", "property_management")
      .in(
        "payment_date",
        rows.map((row) => row.paymentDate)
      );
    if (existingError) return { ok: false, error: toHebrewError(existingError, "שגיאה בקביעת התשלומים.") };
    const existingMonths = new Set(
      (existingRows ?? []).map((row) => (row as { payment_date: string }).payment_date)
    );
    const newRows = rows.filter((row) => !existingMonths.has(row.paymentDate));
    const skipped = rows.length - newRows.length;
    if (newRows.length === 0) {
      return { ok: false, error: "לכל החודשים שנבחרו כבר נקבע תשלום קודם." };
    }

    const inserts = newRows.map((row) =>
      buildPaymentInsert({
        amountTotal: row.amount,
        businessDomain: "property_management",
        propertyId,
        paymentDate: row.paymentDate,
        paymentMethod: "check",
        paymentStatus: "pending",
        checkNumber: row.checkNumber || null,
        dueDate: row.dueDate,
        accountId,
        recordedBy: ctx.profile.id,
      })
    );

    const { error } = await ctx.supabase.from("payments").insert(inserts);
    if (error) return { ok: false, error: toHebrewError(error, "שגיאה בקביעת התשלומים.") };

    revalidateProperties(propertyId);
    return { ok: true, inserted: newRows.length, skipped };
  } catch (error) {
    return { ok: false, error: toHebrewError(error, "שגיאה בקביעת התשלומים.") };
  }
}

"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth/requireProfile";
import { toHebrewError } from "@/lib/error-messages";
import { buildPaymentInsert, PAYMENT_METHOD_OPTIONS } from "@/lib/payments";
import { paidTowards, rentAllocationOf, type RentLease } from "@/lib/property-rent";
import type { PropertyInput } from "./property-types";
import { addressColumnsKeepingMark, parseStructuredAddress } from "@/lib/address/columns";
import { addressLine } from "@/lib/address/structured";

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
  keys_handed_over: string; // how many keys this tenant got at move-in
  rent_day_of_month: string; // "" → null (fall back to the start date's day)
  /** 'gregorian' | 'hebrew' — paid on a day of the regular or the Hebrew month. */
  rent_calendar?: string;
  rent_hebrew_day?: string; // 1–30, for a Hebrew-calendar lease
  period_months?: string; // "1" monthly, "12" yearly
  area_sqm?: string;
  unit_label?: string;
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

function positiveOrNull(value: string | null | undefined) {
  const n = numOrNull(value ?? "");
  return n != null && n > 0 ? n : null;
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
  // The address picked from Google, checked; its line still written for what
  // reads the old column. None picked: the line as it was (saved before the picker).
  const addr = parseStructuredAddress(input.addr) ?? null;
  return {
    name: clean(input.name),
    address: addr ? addressLine(addr) : clean(input.address) ?? "",
    ...addressColumnsKeepingMark(addr, "addr", input.addr_not_found === true),
    asset_description: clean(input.asset_description),
    is_active: input.is_active,
    property_type: clean(input.property_type),
    apartments_count: numOrNull(input.apartments_count),
    rooms: numOrNull(input.rooms),
    square_meters: numOrNull(input.square_meters),
    floor: numOrNull(input.floor),
    bathrooms: numOrNull(input.bathrooms),
    mezuzah_count: numOrNull(input.mezuzah_count),
    light_bulb_count: numOrNull(input.light_bulb_count),
    key_count: numOrNull(input.key_count),
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
    electricity_contract_number: clean(input.electricity_contract_number),
    water_contract_number: clean(input.water_contract_number),
    gas_contract_number: clean(input.gas_contract_number),
    arnona_contract_number: clean(input.arnona_contract_number),
    is_furnished: input.is_furnished,
    furniture_items: input.furniture_items,
    ...companyFields(input),
    ...placeFields(input),
    ...linkFields(input),
  };
}

/** Its tax-account and land-registry links (owner, 2026-10-23) — left as they are when a form from before them saves. */
function linkFields(input: PropertyInput) {
  if (typeof input.tax_account_url !== "string") return {};
  return {
    tax_account_url: clean(input.tax_account_url),
    land_registry_url: clean(input.land_registry_url),
    land_title_url: clean(input.land_title_url),
  };
}

/** ייעוד, מחוז and the tax account (owner, 2026-10-23) — left as they are when a form from before them saves. */
function placeFields(input: PropertyInput) {
  if (typeof input.zoning !== "string") return {};
  return {
    zoning: clean(input.zoning),
    region: clean(input.region),
    tax_account_number: clean(input.tax_account_number),
  };
}

/** The management company and the owning company (owner, 2026-10-23) — left as they are when a form from before
 *  them (an app not yet updated) saves, rather than emptied. */
function companyFields(input: PropertyInput) {
  if (typeof input.rent_managed_by_company !== "boolean") return {};
  return {
    rent_managed_by_company: input.rent_managed_by_company,
    management_company_name: clean(input.management_company_name),
    management_portal_url: clean(input.management_portal_url),
    management_notes: clean(input.management_notes),
    owner_company_name: clean(input.owner_company_name),
    owner_company_number: clean(input.owner_company_number),
    owner_company_type: clean(input.owner_company_type),
    owner_company_url: clean(input.owner_company_url),
    owner_company_notes: clean(input.owner_company_notes),
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
    keys_handed_over: numOrNull(input.keys_handed_over),
    rent_day_of_month: rentDay(input.rent_day_of_month),
    ...rentCalendarFields(input),
    period_months: input.period_months === "12" ? 12 : 1,
    area_sqm: positiveOrNull(input.area_sqm),
    unit_label: clean(input.unit_label),
  };
}

/** A Hebrew-calendar lease needs its Hebrew day; without one it stays on the regular calendar. */
function rentCalendarFields(input: LeaseInput): { rent_calendar: "gregorian" | "hebrew"; rent_hebrew_day: number | null } {
  const day = Math.round(Number(input.rent_hebrew_day));
  if (input.rent_calendar === "hebrew" && day >= 1 && day <= 30) return { rent_calendar: "hebrew", rent_hebrew_day: day };
  return { rent_calendar: "gregorian", rent_hebrew_day: null };
}

/** 1–31, or null to keep falling back to the lease's start day. */
function rentDay(value: string | null | undefined): number | null {
  const n = Number(typeof value === "string" ? value.trim() : value);
  if (!Number.isFinite(n)) return null;
  const day = Math.round(n);
  return day >= 1 && day <= 31 ? day : null;
}

export async function createLease(propertyId: string, input: LeaseInput): Promise<ActionResult> {
  try {
    const ctx = await getStaffContext();
    if (!ctx.ok) return { ok: false, error: ctx.error };
    if (!propertyId) return { ok: false, error: "חסר מזהה נכס." };
    if (!input.customer_id) return { ok: false, error: "יש לבחור לקוח." };
    if (!input.start_date) return { ok: false, error: "יש להזין תאריך התחלת שכירות." };
    if (!(Number(input.monthly_rent_amount) > 0)) return { ok: false, error: "יש להזין סכום תקין." };
    if (input.rent_calendar === "hebrew" && !(Number(input.rent_hebrew_day) >= 1)) {
      return { ok: false, error: "יש לבחור את היום בחודש העברי." };
    }

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
    if (!(Number(input.monthly_rent_amount) > 0)) return { ok: false, error: "יש להזין סכום תקין." };
    if (input.rent_calendar === "hebrew" && !(Number(input.rent_hebrew_day) >= 1)) {
      return { ok: false, error: "יש לבחור את היום בחודש העברי." };
    }

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
  /** The lease period it pays (lib/rent-periods.ts), when the schedule follows a lease. */
  periodStart?: string | null;
};

export type ScheduleRentResult =
  | { ok: true; inserted: number; skipped: number }
  | { ok: false; error: string };

/**
 * Pre-schedule a batch of rent payments for a property (one per rental month),
 * each still pending: payment_date = the rental month it covers, due_date =
 * when the money actually moves (the post-dated check's פירעון, the standing
 * transfer's date…). The method applies to the whole batch — a lease is paid
 * one way — and check_number is only meaningful for 'check'. Purely additive —
 * never deletes/replaces existing rows, so re-running to extend the schedule is
 * safe — but rows whose rental month already has a scheduled payment for this
 * property are skipped rather than double-booked (a double-submit or an
 * overlapping "extend the schedule" run should not create duplicates).
 * With its lease, each row is that lease's rent for its period (lease_id,
 * rent_period_start), and a period one of its payments already covers is the
 * one skipped — a Hebrew lease's period is א׳ of the month, whatever its date.
 */
export async function scheduleRentPayments(
  propertyId: string,
  rows: RentScheduleRowInput[],
  accountId: string,
  paymentMethod: string = "check",
  leaseId: string | null = null
): Promise<ScheduleRentResult> {
  try {
    const ctx = await getStaffContext();
    if (!ctx.ok) return { ok: false, error: ctx.error };
    if (!propertyId) return { ok: false, error: "חסר מזהה נכס." };
    if (rows.length === 0) return { ok: false, error: "לא הוזנו תשלומים." };
    if (!accountId) return { ok: false, error: "יש לבחור חשבון." };
    const method = PAYMENT_METHOD_OPTIONS.some((m) => m.value === paymentMethod)
      ? paymentMethod
      : "";
    if (!method) return { ok: false, error: "אמצעי תשלום לא תקין." };
    const invalid = rows.find((row) => !row.paymentDate || !row.dueDate || !(row.amount > 0));
    if (invalid) return { ok: false, error: "כל תשלום חייב תאריך לחודש, תאריך פרעון וסכום תקין." };

    let lease: RentLease | null = null;
    if (leaseId) {
      const { data: leaseRow, error: leaseError } = await ctx.supabase
        .from("lease_agreements")
        .select("id,status,start_date,end_date,monthly_rent_amount,rent_day_of_month,rent_calendar,rent_hebrew_day,period_months")
        .eq("id", leaseId)
        .eq("property_id", propertyId)
        .maybeSingle();
      if (leaseError) return { ok: false, error: toHebrewError(leaseError, "שגיאה בקביעת התשלומים.") };
      if (!leaseRow) return { ok: false, error: "החוזה לא נמצא בנכס הזה." };
      lease = {
        id: leaseRow.id,
        status: leaseRow.status,
        startDate: leaseRow.start_date,
        endDate: leaseRow.end_date,
        monthlyRentAmount: Number(leaseRow.monthly_rent_amount) || 0,
        rentDayOfMonth: leaseRow.rent_day_of_month,
        rentCalendar: leaseRow.rent_calendar,
        rentHebrewDay: leaseRow.rent_hebrew_day,
        periodMonths: leaseRow.period_months,
      };
    }

    let newRows: RentScheduleRowInput[];
    if (lease) {
      // A period this lease's payments already cover (by the month they say, or their date).
      const { data: existingRows, error: existingError } = await ctx.supabase
        .from("payments")
        .select("payment_date,payment_status,amount_total,lease_id,rent_period_start,rent_periods,rent_allocation,counts_as_rent")
        .eq("property_id", propertyId)
        .eq("business_domain", "property_management");
      if (existingError) return { ok: false, error: toHebrewError(existingError, "שגיאה בקביעת התשלומים.") };
      const rentLease = lease;
      // A bounced check covers nothing (its status can be empty, so it's left out here, not in the query).
      const existing = (existingRows ?? []).filter((row) => row.payment_status !== "rejected").map((row) => ({
        date: row.payment_date as string | null,
        paymentStatus: row.payment_status as string | null,
        amount: Number(row.amount_total) || 0,
        leaseId: row.lease_id as string | null,
        periodStart: row.rent_period_start as string | null,
        periods: row.rent_periods as number | null,
        countsAsRent: row.counts_as_rent as boolean | null,
        allocation: rentAllocationOf(row.rent_allocation),
      }));
      newRows = rows.filter((row) => {
        const period = row.periodStart ?? row.paymentDate;
        return !existing.some((payment) => paidTowards(rentLease, { ...payment, amount: 1 }, period) > 0);
      });
    } else {
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
      newRows = rows.filter((row) => !existingMonths.has(row.paymentDate));
    }
    const skipped = rows.length - newRows.length;
    if (newRows.length === 0) {
      return { ok: false, error: "לכל החודשים שנבחרו כבר נקבע תשלום קודם." };
    }

    const inserts = newRows.map((row) => ({
      ...buildPaymentInsert({
        amountTotal: row.amount,
        businessDomain: "property_management",
        propertyId,
        paymentDate: row.paymentDate,
        paymentMethod: method,
        paymentStatus: "pending",
        checkNumber: method === "check" ? row.checkNumber || null : null,
        dueDate: row.dueDate,
        accountId,
        recordedBy: ctx.profile.id,
      }),
      ...(lease ? { lease_id: lease.id, rent_period_start: row.periodStart ?? row.paymentDate, rent_periods: 1 } : {}),
    }));

    const { error } = await ctx.supabase.from("payments").insert(inserts);
    if (error) return { ok: false, error: toHebrewError(error, "שגיאה בקביעת התשלומים.") };

    revalidateProperties(propertyId);
    return { ok: true, inserted: newRows.length, skipped };
  } catch (error) {
    return { ok: false, error: toHebrewError(error, "שגיאה בקביעת התשלומים.") };
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The properties list in the owner's own order (the ניהול נכסים card: "drag
 * the properties into my own order"): each one's place, 1 on, as dragged.
 * Only the ones whose place changed are written — a drag one place down is
 * two rows, not the whole list (each write is a line in the activity log).
 */
export async function setPropertyOrder(ids: string[]): Promise<ActionResult> {
  try {
    const ctx = await getStaffContext();
    if (!ctx.ok) return { ok: false, error: ctx.error };
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 500 || !ids.every((id) => UUID.test(id))) {
      return { ok: false, error: "סדר לא תקין." };
    }
    if (new Set(ids).size !== ids.length) return { ok: false, error: "סדר לא תקין." };
    const { data: current, error: readError } = await ctx.supabase.from("properties").select("id,sort_order").in("id", ids);
    if (readError) return { ok: false, error: toHebrewError(readError, "שמירת הסדר נכשלה.") };
    const placeNow = new Map(((current ?? []) as Array<{ id: string; sort_order: number | null }>).map((r) => [r.id, r.sort_order]));
    const moved = ids.map((id, index) => ({ id, place: index + 1 })).filter(({ id, place }) => placeNow.get(id) !== place);
    const results = await Promise.all(
      moved.map(({ id, place }) => ctx.supabase.from("properties").update({ sort_order: place }).eq("id", id))
    );
    const failed = results.find((result) => result.error);
    if (failed?.error) return { ok: false, error: toHebrewError(failed.error, "שמירת הסדר נכשלה.") };
    revalidatePath("/properties");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toHebrewError(error, "שמירת הסדר נכשלה.") };
  }
}

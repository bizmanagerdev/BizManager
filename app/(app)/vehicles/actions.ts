"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth/requireProfile";
import { toHebrewError } from "@/lib/error-messages";
import type { VehicleInput } from "@/lib/vehicles";

// Not exported: "use server" files register every export as a callable
// server action reference, and a type-only export here (this bit us with
// `export type { VehicleInput }`, which threw "ReferenceError: VehicleInput
// is not defined" server-side on every commit) has no runtime value to
// register. Nothing outside this file imports these types anyway — VehicleInput
// comes from lib/vehicles directly.
type ActionResult = { ok: true; tagId?: string } | { ok: false; error: string };

function clean(value: string | null | undefined) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? trimmed : null;
}

function yearOrNull(value: string) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1900 && n <= 2100 ? n : null;
}

async function getStaffContext() {
  const { profile, supabase } = await requireProfile();
  if (profile.role !== "admin" && profile.role !== "office") {
    return { ok: false as const, error: "אין הרשאה לבצע פעולה זו." };
  }
  return { ok: true as const, profile, supabase };
}

function revalidateVehicles(tagId?: string) {
  revalidatePath("/vehicles");
  if (tagId) revalidatePath(`/vehicles/${tagId}`);
}

function vehicleFields(input: VehicleInput) {
  return {
    license_plate: clean(input.license_plate),
    make_model: clean(input.make_model),
    year: yearOrNull(input.year),
    test_due_date: clean(input.test_due_date),
    insurance_due_date: clean(input.insurance_due_date),
    license_due_date: clean(input.license_due_date),
    owner_name: clean(input.owner_name),
    notes: clean(input.notes),
  };
}

/** A friendly default name when the user leaves it blank: "דגם · מספר רישוי". */
function deriveName(input: VehicleInput) {
  const explicit = clean(input.name);
  if (explicit) return explicit;
  const parts = [clean(input.make_model), clean(input.license_plate)].filter(Boolean);
  return parts.length ? parts.join(" · ") : "רכב";
}

export async function createVehicle(input: VehicleInput): Promise<ActionResult> {
  try {
    const ctx = await getStaffContext();
    if (!ctx.ok) return { ok: false, error: ctx.error };

    // 1) the generic tag (kind='vehicle') — this id is the vehicle's identity.
    const { data: tag, error: tagError } = await ctx.supabase
      .from("tags")
      .insert({
        kind: "vehicle",
        name: deriveName(input),
        color: clean(input.color),
        created_by: ctx.profile.id,
      })
      .select("id")
      .single();
    if (tagError || !tag) return { ok: false, error: toHebrewError(tagError?.message, "שגיאה ביצירת הרכב.") };

    const tagId = (tag as { id: string }).id;

    // 2) the structured detail row.
    const { error: vehError } = await ctx.supabase
      .from("vehicles")
      .insert({ tag_id: tagId, ...vehicleFields(input) });
    if (vehError) {
      // roll back the orphan tag so we don't leave a vehicle-less tag behind
      await ctx.supabase.from("tags").delete().eq("id", tagId);
      return { ok: false, error: toHebrewError(vehError.message, "שגיאה ביצירת הרכב.") };
    }

    revalidateVehicles(tagId);
    return { ok: true, tagId };
  } catch (error) {
    return { ok: false, error: toHebrewError(error, "שגיאה ביצירת הרכב.") };
  }
}

export async function updateVehicle(tagId: string, input: VehicleInput): Promise<ActionResult> {
  try {
    const ctx = await getStaffContext();
    if (!ctx.ok) return { ok: false, error: ctx.error };
    if (!tagId) return { ok: false, error: "חסר מזהה רכב." };

    const { error: tagError } = await ctx.supabase
      .from("tags")
      .update({ name: deriveName(input), color: clean(input.color), updated_at: new Date().toISOString() })
      .eq("id", tagId)
      .eq("kind", "vehicle");
    if (tagError) return { ok: false, error: toHebrewError(tagError.message, "שגיאה בעדכון הרכב.") };

    const { error: vehError } = await ctx.supabase
      .from("vehicles")
      .update({ ...vehicleFields(input), updated_at: new Date().toISOString() })
      .eq("tag_id", tagId);
    if (vehError) return { ok: false, error: toHebrewError(vehError.message, "שגיאה בעדכון הרכב.") };

    revalidateVehicles(tagId);
    return { ok: true, tagId };
  } catch (error) {
    return { ok: false, error: toHebrewError(error, "שגיאה בעדכון הרכב.") };
  }
}

/**
 * Delete the vehicle. Removing the tag cascades the vehicles row AND its
 * entity_tags links — but the underlying expenses/tasks/documents are NEVER
 * touched, they simply stop being tagged to this car.
 */
export async function deleteVehicle(tagId: string): Promise<ActionResult> {
  try {
    const ctx = await getStaffContext();
    if (!ctx.ok) return { ok: false, error: ctx.error };
    if (!tagId) return { ok: false, error: "חסר מזהה רכב." };

    const { error } = await ctx.supabase.from("tags").delete().eq("id", tagId).eq("kind", "vehicle");
    if (error) return { ok: false, error: toHebrewError(error.message, "שגיאה במחיקת הרכב.") };

    revalidateVehicles();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toHebrewError(error, "שגיאה במחיקת הרכב.") };
  }
}

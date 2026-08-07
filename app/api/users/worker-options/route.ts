import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { toHebrewError } from "@/lib/error-messages";
import { isMissingLinkColumn, type WorkerOption } from "@/lib/customers/workerLink";

type Row = Record<string, unknown>;

const s = (row: Row, key: string) => (typeof row[key] === "string" ? (row[key] as string) : "");

/**
 * Staff list for the "עובד מקושר" picker in the customer form — everyone on the
 * payroll, including `worker_no_access` (a worker without a login is still a
 * worker who can buy from us), each carrying the customer he is already linked
 * to so the form can't offer a second link for the same person.
 *
 * Admin/office only: this exposes staff phone numbers, and they are the only
 * roles that manage customers anyway. Everyone else gets an empty list and the
 * picker simply doesn't render.
 */
export async function GET() {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    if (profile.role !== "admin" && profile.role !== "office") {
      return NextResponse.json({ workers: [] as WorkerOption[] });
    }

    const [usersRes, linkedRes] = await Promise.all([
      supabase
        .from("users")
        .select("id,full_name,email,phone,active")
        .eq("active", true)
        .order("full_name", { ascending: true })
        .range(0, 499),
      supabase
        .from("customers")
        .select("id,name,linked_user_id")
        .not("linked_user_id", "is", null)
        .range(0, 499),
    ]);

    if (usersRes.error) {
      return NextResponse.json({ error: toHebrewError(usersRes.error.message) }, { status: 400 });
    }

    // Before the migration runs there is no link column — the picker still lists
    // everyone, just with nothing marked as already linked.
    const linkedByUserId = new Map<string, { id: string; name: string }>();
    if (!isMissingLinkColumn(linkedRes.error)) {
      ((linkedRes.data ?? []) as Row[]).forEach((row) => {
        const userId = s(row, "linked_user_id");
        if (userId) linkedByUserId.set(userId, { id: s(row, "id"), name: s(row, "name") });
      });
    }

    const workers: WorkerOption[] = ((usersRes.data ?? []) as Row[])
      .map((row) => {
        const id = s(row, "id");
        const linked = linkedByUserId.get(id) ?? null;
        return {
          id,
          label: s(row, "full_name") || s(row, "email") || "ללא שם",
          phone: s(row, "phone") || null,
          linkedCustomerId: linked?.id ?? null,
          linkedCustomerName: linked?.name ?? null,
        };
      })
      .filter((worker) => worker.id);

    return NextResponse.json({ workers });
  } catch (err: unknown) {
    return NextResponse.json({ error: toHebrewError(err, "שגיאה לא ידועה") }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { toHebrewError } from "@/lib/error-messages";
import { logAuditEvent } from "@/lib/audit";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { loadAccounts } from "@/lib/accounts";

// Admin/office accounts CRUD (חשבונות). Same gate as the accounts RLS policy.
const ALLOWED_KINDS = new Set(["bank", "cash", "card"]);

function isManager(role: string | null | undefined) {
  return role === "admin" || role === "office";
}

function sanitizeName(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function sanitizeNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function sanitizeDate(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
    ? value.trim()
    : null;
}

export async function GET() {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const accounts = await loadAccounts(access.value.supabase);
    return NextResponse.json({ accounts });
  } catch (err: unknown) {
    return NextResponse.json({ error: toHebrewError(err, "טעינת החשבונות נכשלה.") }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;
    if (!isManager(profile.role)) {
      return NextResponse.json({ error: "אין הרשאה לנהל חשבונות." }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const name = sanitizeName(body.name);
    const kind = typeof body.kind === "string" ? body.kind : "bank";
    const openingBalance = sanitizeNumber(body.opening_balance) ?? 0;
    const openingDate = sanitizeDate(body.opening_date);

    if (!name) return NextResponse.json({ error: "יש להזין שם לחשבון." }, { status: 400 });
    if (!ALLOWED_KINDS.has(kind)) return NextResponse.json({ error: "סוג חשבון אינו תקין." }, { status: 400 });
    if (!openingDate) return NextResponse.json({ error: "יש לבחור תאריך פתיחה." }, { status: 400 });

    const { data, error } = await supabase
      .from("accounts")
      .insert({
        name,
        kind,
        opening_balance: openingBalance,
        opening_date: openingDate,
        notes: sanitizeName(body.notes) || null,
        sort_order: sanitizeNumber(body.sort_order) ?? 0,
      })
      .select("id")
      .single();
    if (error) throw error;

    await logAuditEvent({
      supabase,
      tableName: "accounts",
      recordId: (data as { id: string }).id,
      action: "create",
      changedBy: profile.id,
      userRole: profile.role,
      newData: { name, kind, opening_balance: openingBalance, opening_date: openingDate },
    });

    return NextResponse.json({ id: (data as { id: string }).id });
  } catch (err: unknown) {
    return NextResponse.json({ error: toHebrewError(err, "יצירת החשבון נכשלה.") }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;
    if (!isManager(profile.role)) {
      return NextResponse.json({ error: "אין הרשאה לנהל חשבונות." }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return NextResponse.json({ error: "חסר מזהה חשבון." }, { status: 400 });

    const patch: Record<string, string | number | boolean | null> = {
      updated_at: new Date().toISOString(),
    };
    if ("name" in body) {
      const name = sanitizeName(body.name);
      if (!name) return NextResponse.json({ error: "יש להזין שם לחשבון." }, { status: 400 });
      patch.name = name;
    }
    if ("kind" in body && typeof body.kind === "string") {
      if (!ALLOWED_KINDS.has(body.kind)) return NextResponse.json({ error: "סוג חשבון אינו תקין." }, { status: 400 });
      patch.kind = body.kind;
    }
    if ("opening_balance" in body) patch.opening_balance = sanitizeNumber(body.opening_balance) ?? 0;
    if ("opening_date" in body) {
      const d = sanitizeDate(body.opening_date);
      if (!d) return NextResponse.json({ error: "תאריך פתיחה אינו תקין." }, { status: 400 });
      patch.opening_date = d;
    }
    if ("is_active" in body) patch.is_active = body.is_active !== false;
    if ("sort_order" in body) patch.sort_order = sanitizeNumber(body.sort_order) ?? 0;
    if ("notes" in body) patch.notes = sanitizeName(body.notes) || null;

    const { error } = await supabase.from("accounts").update(patch).eq("id", id);
    if (error) throw error;

    await logAuditEvent({
      supabase,
      tableName: "accounts",
      recordId: id,
      action: "update",
      changedBy: profile.id,
      userRole: profile.role,
      newData: patch,
    });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return NextResponse.json({ error: toHebrewError(err, "עדכון החשבון נכשל.") }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;
    if (!isManager(profile.role)) {
      return NextResponse.json({ error: "אין הרשאה לנהל חשבונות." }, { status: 403 });
    }

    const id = new URL(req.url).searchParams.get("id") ?? "";
    if (!id) return NextResponse.json({ error: "חסר מזהה חשבון." }, { status: 400 });

    // FK is ON DELETE SET NULL, so deleting an account un-assigns its rows rather
    // than removing any payment/expense. Deactivating is usually preferred, but a
    // hard delete is allowed for accounts created by mistake.
    const { error } = await supabase.from("accounts").delete().eq("id", id);
    if (error) throw error;

    await logAuditEvent({
      supabase,
      tableName: "accounts",
      recordId: id,
      action: "delete",
      changedBy: profile.id,
      userRole: profile.role,
    });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return NextResponse.json({ error: toHebrewError(err, "מחיקת החשבון נכשלה.") }, { status: 500 });
  }
}

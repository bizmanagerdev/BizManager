import { NextResponse } from "next/server";
import { toHebrewError } from "@/lib/error-messages";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

// העברה בין חשבונות — money moved between two of our own accounts (a cash
// withdrawal from the bank, or topping up the account a payment has to leave
// from). Deliberately NOT an expense+income pair: a transfer is profit-neutral
// and cash-neutral, so it only ever touches the accounts ledger.
//
// Same gate as the accounts table's RLS policy: admin/office.

function isAllowed(role: string | null | undefined) {
  return role === "admin" || role === "office";
}

function sanitizeId(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function sanitizeAmount(value: unknown) {
  const n = typeof value === "number" ? value : Number(typeof value === "string" ? value.trim() : NaN);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function sanitizeDate(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? value.trim() : null;
}

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;
    if (!isAllowed(profile.role)) {
      return NextResponse.json({ error: "אין הרשאה לרשום העברה בין חשבונות." }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const fromAccountId = sanitizeId(body.from_account_id);
    const toAccountId = sanitizeId(body.to_account_id);
    const amount = sanitizeAmount(body.amount);
    const transferDate = sanitizeDate(body.transfer_date);

    if (!fromAccountId) return NextResponse.json({ error: "יש לבחור חשבון מקור." }, { status: 400 });
    if (!toAccountId) return NextResponse.json({ error: "יש לבחור חשבון יעד." }, { status: 400 });
    if (fromAccountId === toAccountId) {
      return NextResponse.json({ error: "לא ניתן להעביר לאותו חשבון." }, { status: 400 });
    }
    if (amount === null) return NextResponse.json({ error: "יש להזין סכום תקין." }, { status: 400 });
    if (!transferDate) return NextResponse.json({ error: "יש לבחור תאריך." }, { status: 400 });

    const { data, error } = await supabase
      .from("account_transfers")
      .insert({
        from_account_id: fromAccountId,
        to_account_id: toAccountId,
        amount,
        transfer_date: transferDate,
        notes: typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null,
        created_by: profile.id,
      })
      .select("id")
      .single();
    if (error) throw error;

    // Audited by trg_audit_account_transfers (see the migration) — no app-side
    // logAuditEvent here, or the activity feed would show every transfer twice.
    return NextResponse.json({ id: (data as { id: string }).id });
  } catch (err: unknown) {
    return NextResponse.json({ error: toHebrewError(err, "שמירת ההעברה נכשלה.") }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;
    if (!isAllowed(profile.role)) {
      return NextResponse.json({ error: "אין הרשאה לערוך העברה בין חשבונות." }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const id = sanitizeId(body.id);
    if (!id) return NextResponse.json({ error: "חסר מזהה העברה." }, { status: 400 });

    // Both sides always arrive together — an edit that changed only one of them
    // could otherwise land on a row whose other side is now the same account.
    const fromAccountId = sanitizeId(body.from_account_id);
    const toAccountId = sanitizeId(body.to_account_id);
    const amount = sanitizeAmount(body.amount);
    const transferDate = sanitizeDate(body.transfer_date);

    if (!fromAccountId) return NextResponse.json({ error: "יש לבחור חשבון מקור." }, { status: 400 });
    if (!toAccountId) return NextResponse.json({ error: "יש לבחור חשבון יעד." }, { status: 400 });
    if (fromAccountId === toAccountId) {
      return NextResponse.json({ error: "לא ניתן להעביר לאותו חשבון." }, { status: 400 });
    }
    if (amount === null) return NextResponse.json({ error: "יש להזין סכום תקין." }, { status: 400 });
    if (!transferDate) return NextResponse.json({ error: "יש לבחור תאריך." }, { status: 400 });

    const { error } = await supabase
      .from("account_transfers")
      .update({
        from_account_id: fromAccountId,
        to_account_id: toAccountId,
        amount,
        transfer_date: transferDate,
        notes: typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return NextResponse.json({ error: toHebrewError(err, "עדכון ההעברה נכשל.") }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;
    if (!isAllowed(profile.role)) {
      return NextResponse.json({ error: "אין הרשאה למחוק העברה בין חשבונות." }, { status: 403 });
    }

    const id = new URL(req.url).searchParams.get("id") ?? "";
    if (!id) return NextResponse.json({ error: "חסר מזהה העברה." }, { status: 400 });

    // Deleting removes BOTH legs at once — the row IS the pair, so the two
    // balances can never drift apart.
    const { error } = await supabase.from("account_transfers").delete().eq("id", id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return NextResponse.json({ error: toHebrewError(err, "מחיקת ההעברה נכשלה.") }, { status: 500 });
  }
}
